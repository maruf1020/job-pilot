import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/** Loading placeholders that match the real layouts, so pages do not jump when data arrives. */

export function MetricsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

export function SectionSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-36" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 8, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div className="flex gap-4 border-b bg-muted/40 px-4 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b px-4 py-3 last:border-0">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={cn('h-3.5 flex-1', i === 0 && 'flex-[2]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Header + metrics + two sections: the shape of most pages while their first query loads. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <MetricsSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionSkeleton />
        <SectionSkeleton />
      </div>
    </div>
  )
}
