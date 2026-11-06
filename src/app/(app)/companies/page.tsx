import { Suspense } from 'react'
import { CompaniesSummary, CompaniesTable } from '@/components/companies/companies-table'
import { BoardDiscoveryButton, BoardDiscoveryStatus } from '@/components/companies/board-discovery'
import { SponsorRegistersDialog } from '@/components/companies/sponsor-tools'
import { ContactBatchButton, ContactBatchStatus } from '@/components/contacts/contact-batch'
import { PageHeader } from '@/components/shared/page-header'
import { TableSkeleton } from '@/components/shared/skeletons'

export const metadata = { title: 'Companies' }

export default function CompaniesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Companies"
        description={<CompaniesSummary />}
        actions={
          <>
            <SponsorRegistersDialog />
            <BoardDiscoveryButton />
            <ContactBatchButton />
          </>
        }
      >
        <BoardDiscoveryStatus />
        <ContactBatchStatus />
      </PageHeader>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <CompaniesTable />
      </Suspense>
    </div>
  )
}
