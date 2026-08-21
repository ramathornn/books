import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { absolutePath } from '@/lib/attachments'
import fs from 'node:fs/promises'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })
  const { id } = await params

  const att = await prisma.attachment.findUnique({ where: { id } })
  if (!att || att.isArchived) return new Response('Not found', { status: 404 })

  const fullPath = absolutePath(att.storagePath)
  try {
    const buf = await fs.readFile(fullPath)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': att.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${att.fileName.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch {
    return new Response('File missing on disk', { status: 410 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const att = await prisma.attachment.findUnique({ where: { id } })
  if (!att) return Response.json({ error: 'Not found' }, { status: 404 })

  // Soft delete (keep file on disk for audit/recovery)
  await prisma.attachment.update({ where: { id }, data: { isArchived: true } })
  return Response.json({ archived: true })
}
