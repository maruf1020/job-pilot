import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ApplicationsView } from '@/components/applications/applications-view'
import { Skeleton } from '@/components/ui/skeleton'

export const metadata: Metadata = { title: 'Applications' }

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <ApplicationsView />
    </Suspense>
  )
}
