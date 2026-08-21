import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { validateName, absolutePath } from '@/lib/files'
import fs from 'node:fs/promises'

// PATCH /api/files/[id] — rename a file ({ name }) and/or move it to another
// folder ({ folderId } — null/'root' for the top level). Bytes are untouched.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const file = await prisma.storedFile.findUnique({ where: { id } })
  if (!file) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; folderId?: unknown }
    | null
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: { name?: string; folderId?: string | null } = {}

  if ('name' in body) {
    const check = validateName(body.name)
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 })
    data.name = check.name
  }

  if ('folderId' in body) {
    const raw = body.folderId
    const folderId = typeof raw === 'string' && raw && raw !== 'root' ? raw : null
    if (folderId) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } })
      if (!folder) return Response.json({ error: 'Folder not found' }, { status: 404 })
    }
    data.folderId = folderId
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.storedFile.update({
    where: { id },
    data,
    select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true },
  })
  return Response.json(updated)
}

// DELETE /api/files/[id] — remove the DB row and the bytes on disk.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const file = await prisma.storedFile.findUnique({ where: { id } })
  if (!file) return Response.json({ error: 'Not found' }, { status: 404 })

  await prisma.storedFile.delete({ where: { id } })
  await fs.unlink(absolutePath(file.storagePath)).catch(() => undefined)

  return Response.json({ deleted: true })
}
