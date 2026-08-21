import path from 'node:path'
import fs from 'node:fs/promises'
import prisma from '@/lib/prisma'
import {
  ensureFilesDir,
  newStoragePath,
  absolutePath,
  validateName,
} from '@/lib/files'

// Shared helpers for the headless upload endpoints (/api/files/upload[-bulk]).
// They mirror the existing /api/files + /api/files/folders behavior: folders are
// virtual DB rows, bytes live under UPLOAD_ROOT/files with a server-generated
// random name, and a same-name collision in a folder overwrites in place.

export class FolderPathError extends Error {}

// Resolve a slash-separated folder_path (e.g. "Bank Statements/RBC Chequing 3292")
// to a Folder id, creating any missing segments along the way. An empty/"/" path
// resolves to the root (folderId = null).
export async function resolveFolderPath(
  folderPath: string,
  createdById: string | null
): Promise<{ folderId: string | null; normalizedPath: string }> {
  // Split on both separators, trim, and drop empties so "a//b", "/a/b/", and
  // "a / b" all behave sensibly.
  const segments = folderPath
    .split(/[/\\]/)
    .map((s) => s.trim())
    .filter(Boolean)

  let parentId: string | null = null
  const cleanSegments: string[] = []

  for (const segment of segments) {
    const check = validateName(segment)
    if (!check.ok) {
      throw new FolderPathError(`Invalid folder name "${segment}": ${check.error}`)
    }
    const name = check.name
    cleanSegments.push(name)

    // Reuse an existing folder with this name under this parent, else create it.
    let folder: { id: string } | null = await prisma.folder.findFirst({
      where: { parentId, name },
      select: { id: true },
    })
    if (!folder) {
      folder = await prisma.folder.create({
        data: { name, parentId, createdById },
        select: { id: true },
      })
    }
    parentId = folder.id
  }

  return { folderId: parentId, normalizedPath: cleanSegments.join('/') }
}

// Write the uploaded bytes to disk and create (or overwrite) the StoredFile row.
// On a same-name collision in the same folder we replace the row and delete the
// old bytes from disk. Caller is responsible for size/mime validation.
export async function storeUploadedFile(opts: {
  file: File
  displayName: string
  folderId: string | null
  uploadedById: string | null
}): Promise<{ id: string; name: string; sizeBytes: number }> {
  const { file, displayName, folderId, uploadedById } = opts

  const dir = await ensureFilesDir()
  const { storagePath } = newStoragePath(file.name)
  const fullPath = absolutePath(storagePath)
  // Defense in depth — storagePath is server-generated, but never write outside.
  if (!fullPath.startsWith(dir + path.sep)) {
    throw new Error('Invalid storage path')
  }

  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(fullPath, buf, { mode: 0o600 })

  // Overwrite-on-collision: if a file with this name already exists in the
  // folder, repoint it at the new bytes and remove the stale ones.
  const existing = await prisma.storedFile.findFirst({
    where: { folderId, name: displayName },
    select: { id: true, storagePath: true },
  })

  if (existing) {
    const created = await prisma.storedFile.update({
      where: { id: existing.id },
      data: {
        storagePath,
        mimeType: file.type,
        sizeBytes: buf.length,
        uploadedById,
      },
      select: { id: true, name: true, sizeBytes: true },
    })
    // Best-effort cleanup of the replaced file's bytes.
    if (existing.storagePath && existing.storagePath !== storagePath) {
      try {
        await fs.unlink(absolutePath(existing.storagePath))
      } catch {
        // ignore — orphaned bytes are harmless
      }
    }
    return created
  }

  const created = await prisma.storedFile.create({
    data: {
      name: displayName,
      folderId,
      storagePath,
      mimeType: file.type,
      sizeBytes: buf.length,
      uploadedById,
    },
    select: { id: true, name: true, sizeBytes: true },
  })
  return created
}
