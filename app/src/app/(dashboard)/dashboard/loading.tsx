export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-32 bg-gray-200 rounded" />
        <div className="h-9 w-32 bg-gray-200 rounded" />
      </div>
      {/* Outstanding invoices skeleton */}
      <div className="bg-white rounded-sm shadow-md p-6 mb-6">
        <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
        <div className="h-8 w-full bg-gray-200 rounded mb-4" />
        <div className="grid grid-cols-4 gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="text-center">
              <div className="h-3 w-12 bg-gray-200 rounded mx-auto mb-1" />
              <div className="h-5 w-16 bg-gray-200 rounded mx-auto" />
            </div>
          ))}
        </div>
        <div className="border-t border-gray-200 pt-4">
          <div className="h-3 w-24 bg-gray-200 rounded mb-1" />
          <div className="h-8 w-32 bg-gray-200 rounded" />
        </div>
      </div>
      {/* Charts skeleton */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-sm shadow-md p-6">
          <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
          <div className="h-40 w-full bg-gray-200 rounded" />
        </div>
        <div className="bg-white rounded-sm shadow-md p-6">
          <div className="h-5 w-28 bg-gray-200 rounded mb-4" />
          <div className="h-10 w-32 bg-gray-200 rounded mb-4" />
          <div className="h-32 w-full bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  )
}
