import { Suspense } from 'react'
import { ContactBatchButton, ContactBatchStatus } from '@/components/contacts/contact-batch'
import { JobsSummary, JobsTable } from '@/components/jobs/jobs-table'
import { PageHeader } from '@/components/shared/page-header'
import { TableSkeleton } from '@/components/shared/skeletons'

export const metadata = { title: 'Jobs' }

export default function JobsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" description={<JobsSummary />} actions={<ContactBatchButton />}>
        <ContactBatchStatus />
      </PageHeader>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <JobsTable />
      </Suspense>
    </div>
  )
}
