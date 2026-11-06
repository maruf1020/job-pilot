import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { TableSkeleton } from '@/components/shared/skeletons'
import { ContinuousSearch } from '@/components/runs/continuous-search'
import { RunsTable } from '@/components/runs/runs-table'

export const metadata: Metadata = { title: 'Runs' }

export default function RunsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Runs" description="Every search run: what each source returned, the new jobs it found, and its log." />
      <ContinuousSearch />
      <Suspense fallback={<TableSkeleton rows={8} columns={6} />}>
        <RunsTable />
      </Suspense>
    </div>
  )
}
