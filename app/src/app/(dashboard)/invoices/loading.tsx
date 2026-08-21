export default function InvoicesLoading() {
  return (
    <div className="animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-32 bg-gray-200 rounded" />
        <div className="flex gap-3">
          <div className="h-9 w-24 bg-gray-200 rounded" />
          <div className="h-9 w-28 bg-gray-200 rounded" />
          <div className="h-9 w-28 bg-gray-200 rounded" />
        </div>
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-sm shadow-md p-4">
            <div className="h-6 w-24 bg-gray-200 rounded mb-1" />
            <div className="h-4 w-16 bg-gray-200 rounded" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-sm shadow-md">
        <div className="p-4 border-b border-gray-200">
          <div className="h-4 w-24 bg-gray-200 rounded" />
        </div>
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <div className="h-4 w-full bg-gray-200 rounded" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-gray-100 flex gap-4">
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className="h-4 w-48 bg-gray-200 rounded flex-1" />
            <div className="h-4 w-24 bg-gray-200 rounded" />
            <div className="h-4 w-20 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
