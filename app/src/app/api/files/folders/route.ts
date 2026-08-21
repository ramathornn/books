import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { validateName } from '@/lib/files'

// GET /api/files/folders — the full folder tree (flat list of id/name/parentId),
// used to build the "Move to…" destination picker on the client.
export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const folders = await prisma.folder.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, parentId: true },
  })
  return Response.json({ data: folders })
}

// POST /api/files/folders — create a folder under an optional parent.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const check = validateName((body as { name?: unknown }).name)
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 })

  const parentIdRaw = (body as { parentId?: unknown }).parentId
  const parentId = typeof parentIdRaw === 'string' && parentIdRaw ? parentIdRaw : null

  // Verify the parent exists (and thus belongs to this app's tree) before nesting.
  if (parentId) {
    const parent = await prisma.folder.findUnique({ where: { id: parentId } })
    if (!parent) return Response.json({ error: 'Parent folder not found' }, { status: 404 })
  }

  // Reject duplicate names within the same parent for a clean tree.
  const existing = await prisma.folder.findFirst({
    where: { parentId, name: check.name },
    select: { id: true },
  })
  if (existing) {
    return Response.json({ error: 'A folder with that name already exists here' }, { status: 409 })
  }

  const folder = await prisma.folder.create({
    data: {
      name: check.name,
      parentId,
      createdById: (session.user as { id?: string }).id ?? null,
    },
  })
  return Response.json(folder, { status: 201 })
}
