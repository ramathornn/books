'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalCount?: number
  perPage?: number
  showPerPage?: boolean
  showArchivedLink?: boolean
  archivedLinkText?: string
}

const PER_PAGE_OPTIONS = [25, 40, 50, 100]

export default function Pagination({
  currentPage,
  totalPages,
  totalCount,
  perPage = 40,
  showPerPage = false,
  showArchivedLink = false,
  archivedLinkText = 'View Archived',
}: PaginationProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function buildUrl(page: number, newPerPage?: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', page.toString())
    if (newPerPage) {
      params.set('perPage', newPerPage.toString())
    }
    return `${pathname}?${params.toString()}`
  }

  function buildPerPageUrl(newPerPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('perPage', newPerPage.toString())
    params.set('page', '1')
    return `${pathname}?${params.toString()}`
  }

  if (totalPages <= 1 && !showPerPage && !showArchivedLink) return null

  const startItem = totalCount ? (currentPage - 1) * perPage + 1 : null
  const endItem = totalCount ? Math.min(currentPage * perPage, totalCount) : null

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-500">
          {totalCount
            ? `${startItem}-${endItem} of ${totalCount}`
            : `Page ${currentPage} of ${totalPages}`}
        </div>
        {showPerPage && (
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <span>Show</span>
            <select
              defaultValue={perPage}
              onChange={(e) => {
                window.location.href = buildPerPageUrl(Number(e.target.value))
              }}
              className="border border-gray-300 rounded px-1.5 py-0.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            >
              {PER_PAGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <span>per page</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {showArchivedLink && (
          <span className="text-xs text-[#0075DD] cursor-pointer hover:underline">
            {archivedLinkText}
          </span>
        )}
        <div className="flex gap-2">
          {currentPage > 1 ? (
            <Link
              href={buildUrl(currentPage - 1)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Previous
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-md cursor-not-allowed">
              Previous
            </span>
          )}
          {currentPage < totalPages ? (
            <Link
              href={buildUrl(currentPage + 1)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Next
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-md cursor-not-allowed">
              Next
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
