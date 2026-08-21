export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatDate } from '@/lib/utils'

export const metadata: Metadata = { title: 'Unattached Files' }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Files that are tied to no Expense (expenseId null) and referenced by no
 * Attachment — leftover/orphan uploads the Files manager otherwise can't surface.
 */
export default async function UnattachedFilesPage() {
  const [files, attachments] = await Promise.all([
    prisma.storedFile.findMany({
      where: { expenseId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        storagePath: true,
        folder: { select: { name: true } },
      },
    }),
    prisma.attachment.findMany({ select: { storagePath: true } }),
  ])
  const referenced = new Set(attachments.map((a) => a.storagePath))
  const unattached = files.filter((f) => !referenced.has(f.storagePath))

  return (
    <div>
      <div className="mb-6">
        <Link href="/files" className="text-xs text-[#0075DD] hover:underline">
          Files
        </Link>
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Unattached Files
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Files linked to no expense and referenced by no transaction attachment.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Name</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Folder</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Size</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Added</th>
            </tr>
          </thead>
          <tbody>
            {unattached.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-sm text-[#576981]">
                  No unattached files.
                </td>
              </tr>
            ) : (
              unattached.map((f) => (
                <tr key={f.id} className="border-t border-[#E1E6EB]">
                  <td className="px-4 py-1 text-sm">
                    <a href={`/api/files/${f.id}/content`} className="text-[#0075DD] hover:underline">
                      {f.name}
                    </a>
                  </td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{f.folder?.name || '—'}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{fmtSize(f.sizeBytes)}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{formatDate(f.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
