import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  ensureFilesDir,
  newStoragePath,
  absolutePath,
  validateName,
  ALLOWED_MIME,
  MAX_FILE_SIZE,
} from '@/lib/files'
import path from 'node:path'
import fs from 'node:fs/promises'

// GET /api/files?folderId=... — list files in a folder (root if omitted).
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = request.nextUrl.searchParams.get('folderId')
  const folderId = raw && raw !== 'root' ? raw : null

  const files = await prisma.storedFile.findMany({
    where: { folderId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
  })
  return Response.json({ data: files })
}

// POST /api/files — upload a file into a folder (multipart form-data).
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  const folderIdRaw = form.get('folderId')
  const folderId = typeof folderIdRaw === 'string' && folderIdRaw && folderIdRaw !== 'root'
    ? folderIdRaw
    : null

  if (!(file instanceof File)) {
    return Response.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ error: 'File is empty' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
      { status: 400 }
    )
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, { status: 400 })
  }

  // The display name comes from the upload's filename; validate it like any name.
  const nameCheck = validateName(file.name)
  const displayName = nameCheck.ok ? nameCheck.name : `upload-${Date.now()}`

  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId } })
    if (!folder) return Response.json({ error: 'Folder not found' }, { status: 404 })
  }

  const dir = await ensureFilesDir()
  const { storagePath } = newStoragePath(file.name)
  const fullPath = absolutePath(storagePath)
  // Guard against the (impossible-by-construction) case of writing outside the dir.
  if (!fullPath.startsWith(dir + path.sep)) {
    return Response.json({ error: 'Invalid storage path' }, { status: 500 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(fullPath, buf, { mode: 0o600 })

  const created = await prisma.storedFile.create({
    data: {
      name: displayName,
      folderId,
      storagePath,
      mimeType: file.type,
      sizeBytes: buf.length,
      uploadedById: (session.user as { id?: string }).id ?? null,
    },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
  })
  return Response.json(created, { status: 201 })
}
