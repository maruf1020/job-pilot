import type { Metadata } from 'next'
import { Suspense } from 'react'
import { HostsTable, HostViews } from '@/components/queue/hosts-table'
import { PageHeader } from '@/components/shared/page-header'
import { TableSkeleton } from '@/components/shared/skeletons'

export const metadata: Metadata = { title: 'Hosts' }

export default function HostsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<PageHeader title="Hosts" />}>
        <PageHeader title="Hosts" description="What the browser agent learned about each website. A host that fails the same way several times rests for a week; clear the skip once the cause is fixed.">
          <HostViews />
        </PageHeader>
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <HostsTable />
      </Suspense>
    </div>
  )
}
