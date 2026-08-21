import fs from 'node:fs/promises'
import prisma from '@/lib/prisma'
import { ensureFilesDir, newStoragePath, absolutePath } from '@/lib/files'

/**
 * Stage a NON-SIN tax artifact (a summary worksheet PDF, or the labelled
 * "not transmitted" XML) into the Files manager under `Tax Slips/{year}` and
 * return the StoredFile id. SIN-bearing slip XML is NEVER persisted this way —
 * the filing pipeline regenerates it on authorized download (design finding #13).
 */

const TAX_ROOT_NAME = process.env.TAX_FILES_ROOT_FOLDER || 'Tax Slips'

async function findOrCreateFolder(name: string, parentId: string | null): Promise<{ id: string }> {
  const existing = await prisma.folder.findFirst({ where: { parentId, name }, select: { id: true } })
  if (existing) return existing
  return prisma.folder.create({ data: { name, parentId }, select: { id: true } })
}

async function resolveYearFolder(taxYear: number): Promise<string> {
  const root = await findOrCreateFolder(TAX_ROOT_NAME, null)
  const year = await findOrCreateFolder(String(taxYear), root.id)
  return year.id
}

/** Write bytes into Tax Slips/{year} and return the StoredFile id. */
export async function storeTaxArtifact(args: {
  taxYear: number
  name: string
  mimeType: string
  buffer: Buffer
}): Promise<string> {
  const folderId = await resolveYearFolder(args.taxYear)
  await ensureFilesDir()
  const { storagePath } = newStoragePath(args.name)
  await fs.writeFile(absolutePath(storagePath), args.buffer, { mode: 0o600 })
  const created = await prisma.storedFile.create({
    data: {
      name: args.name,
      folderId,
      storagePath,
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
    },
    select: { id: true },
  })
  return created.id
}
