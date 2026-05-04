// LibrarySkeletonLoader.tsx
//
// Skeleton placeholder shown in the Library page while the query list is loading.
// Renders fake card or row shapes matching the current view mode (grid/list) so
// the layout doesn't shift when real data arrives.

import { Skeleton } from './ui/skeleton'

interface LibrarySkeletonLoaderProps {
  viewMode?: 'grid' | 'list'
  count?: number
}

export function LibrarySkeletonLoader({ viewMode = 'grid', count = 6 }: LibrarySkeletonLoaderProps) {
  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, idx) => (
          <SkeletonCard key={idx} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonRow key={idx} />
      ))}
    </div>
  )
}

// Skeleton Card for Grid View
function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
        <Skeleton className="h-4 w-4 rounded-full flex-shrink-0 ml-2" />
      </div>

      {/* Metadata badges */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-8" />
      </div>
    </div>
  )
}

// Skeleton Row for List View
function SkeletonRow() {
  return (
    <div className="bg-card border border-border rounded-md p-3 flex items-center gap-4 animate-slide-up">
      {/* Name & Description */}
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>

      {/* Category */}
      <Skeleton className="h-5 w-24 rounded-full flex-shrink-0" />

      {/* Stats */}
      <Skeleton className="h-3 w-16 flex-shrink-0" />

      {/* Date */}
      <Skeleton className="h-3 w-20 flex-shrink-0" />

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-8" />
      </div>
    </div>
  )
}

// Category Skeleton for Categories Tab
export function CategorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: count }).map((_, idx) => (
          <div
            key={idx}
            className="bg-card border border-border rounded-lg p-4 animate-slide-up"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
              <Skeleton className="h-8 w-8" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
