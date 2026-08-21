import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { validateName, absolutePath } from '@/lib/files'
import fs from 'node:fs/promises'

// PATCH /api/files/folders/[id] — rename a folder ({ name }) and/or move it under
// a new parent ({ parentId } — null/'root' for the top level). Guards against
// moving a folder into itself or one of its own descendants (which would orphan a
// subtree into a cycle).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const folder = await prisma.folder.findUnique({ where: { id } })
  if (!folder) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; parentId?: unknown }
    | null
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: { name?: string; parentId?: string | null } = {}
  // The name + parent used for the duplicate check (current values unless changed).
  let targetName = folder.name
  let targetParent = folder.parentId

  if ('name' in body) {
    const check = validateName(body.name)
    if (!check.ok) return Response.json({ error: check.error }, { status: 400 })
    data.name = check.name
    targetName = check.name
  }

  if ('parentId' in body) {
    const raw = body.parentId
    const parentId = typeof raw === 'string' && raw && raw !== 'root' ? raw : null
    if (parentId === id) {
      return Response.json({ error: "Can't move a folder into itself" }, { status: 400 })
    }
    if (parentId) {
      // Walk up from the proposed parent to the root; if we meet this folder, the
      // move would create a cycle.
      let cursor: string | null = parentId
      let depth = 0
      while (cursor && depth < 1000) {
        if (cursor === id) {
          return Response.json({ error: "Can't move a folder into its own subfolder" }, { status: 400 })
        }
        const node: { parentId: string | null } | null = await prisma.folder.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        })
        if (!node) return Response.json({ error: 'Destination folder not found' }, { status: 404 })
        cursor = node.parentId
        depth++
      }
    }
    data.parentId = parentId
    targetParent = parentId
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const clash = await prisma.folder.findFirst({
    where: { parentId: targetParent, name: targetName, id: { not: id } },
    select: { id: true },
  })
  if (clash) {
    return Response.json({ error: 'A folder with that name already exists there' }, { status: 409 })
  }

  const updated = await prisma.folder.update({ where: { id }, data })
  return Response.json(updated)
}

// DELETE /api/files/folders/[id] — recursively delete a folder, its subfolders,
// and every file within (DB rows cascade; we remove the bytes from disk too).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const folder = await prisma.folder.findUnique({ where: { id } })
  if (!folder) return Response.json({ error: 'Not found' }, { status: 404 })

  // Walk the subtree to collect every descendant folder id, then gather the
  // storage paths of all files in those folders before the cascade removes them.
  const folderIds: string[] = [id]
  let frontier: string[] = [id]
  while (frontier.length) {
    const children = await prisma.folder.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = children.map((c) => c.id)
    folderIds.push(...frontier)
  }

  const files = await prisma.storedFile.findMany({
    where: { folderId: { in: folderIds } },
    select: { storagePath: true },
  })

  // Delete the folder; Postgres cascades subfolders + file rows.
  await prisma.folder.delete({ where: { id } })

  // Best-effort disk cleanup (DB is already consistent).
  await Promise.allSettled(
    files.map((f) => fs.unlink(absolutePath(f.storagePath)).catch(() => undefined))
  )

  return Response.json({ deleted: true })
}
