export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import FilesExplorer from './FilesExplorer'
import DocumentDropZone from './DocumentDropZone'

export const metadata: Metadata = { title: 'Files' }

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const folderParam = typeof params.folder === 'string' ? params.folder : ''

  // Resolve the current folder; fall back to root if the id is stale/invalid.
  const current = folderParam
    ? await prisma.folder.findUnique({ where: { id: folderParam } })
    : null
  const currentId = current?.id ?? null

  // Build the breadcrumb trail by walking parents up to the root.
  const breadcrumbs: { id: string; name: string }[] = []
  let cursor = current
  // Guard against cycles (shouldn't happen) with a depth cap.
  let depth = 0
  while (cursor && depth < 100) {
    breadcrumbs.unshift({ id: cursor.id, name: cursor.name })
    cursor = cursor.parentId
      ? await prisma.folder.findUnique({ where: { id: cursor.parentId } })
      : null
    depth++
  }

  const [folders, files] = await Promise.all([
    prisma.folder.findMany({
      where: { parentId: currentId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.storedFile.findMany({
      where: { folderId: currentId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true, expenseId: true },
    }),
  ])

  return (
    <>
      <DocumentDropZone />
      <div className="flex justify-end mb-3">
        <Link href="/files/unattached" className="text-sm text-[#0075DD] hover:underline">
          View unattached files
        </Link>
      </div>
      <FilesExplorer
        currentFolderId={currentId}
        breadcrumbs={breadcrumbs}
        folders={folders}
        files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
      />
    </>
  )
}
