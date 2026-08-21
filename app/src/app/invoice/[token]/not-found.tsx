import Link from 'next/link'

export default function InvoiceNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center px-4">
        <div className="mb-6">
          <svg className="w-16 h-16 text-gray-300 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-600 mb-6">This link is no longer valid.</p>
        <Link
          href="/"
          className="inline-flex px-4 py-2 bg-[#0075DD] hover:bg-[#005bb5] text-white text-sm font-medium rounded-md transition-colors"
        >
          Go Home
        </Link>
        <div className="mt-12 text-xs text-gray-400">
          <p>Powered by Books</p>
        </div>
      </div>
    </div>
  )
}
