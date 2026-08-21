import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  ensureEntityDir,
  isValidEntityType,
  ALLOWED_MIME,
  MAX_FILE_SIZE,
  relativeStoragePath,
} from '@/lib/attachments'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const entityType = sp.get('entityType') || ''
  const entityId = sp.get('entityId') || ''
  if (!entityType || !entityId) {
    return Response.json({ error: 'entityType and entityId required' }, { status: 400 })
  }
  const attachments = await prisma.attachment.findMany({
    where: { entityType, entityId, isArchived: false },
    orderBy: { createdAt: 'desc' },
  })
  return Response.json({ data: attachments })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const entityType = String(form.get('entityType') || '')
  const entityId = String(form.get('entityId') || '')
  const file = form.get('file')

  if (!isValidEntityType(entityType)) {
    return Response.json({ error: 'Invalid entityType' }, { status: 400 })
  }
  if (!entityId) {
    return Response.json({ error: 'entityId required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 })
  }

  const dir = await ensureEntityDir(entityType, entityId)
  const ext = path.extname(file.name).toLowerCase() || '.bin'
  const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`
  const fullPath = path.join(dir, safeName)
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(fullPath, buf)

  const storagePath = relativeStoragePath(entityType, entityId, safeName)
  const att = await prisma.attachment.create({
    data: {
      entityType,
      entityId,
      fileName: file.name,
      storagePath,
      mimeType: file.type,
      sizeBytes: buf.length,
      uploadedById: (session.user as { id?: string }).id ?? null,
    },
  })
  return Response.json(att, { status: 201 })
}
