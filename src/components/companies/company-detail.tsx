'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Ban, ExternalLink, Pencil, SearchX, Undo2 } from 'lucide-react'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ToneBadge } from '@/components/shared/status-badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { countryName } from '@/lib/domain'
import { flagEmoji, fmtDate, fmtNumber, titleCase } from '@/lib/format'
import { CompanyContactCard } from './company-contact-card'
import { CompanyEditForm } from './company-edit-form'
import { CompanyFetchCard } from './company-fetch-card'
import { CompanyHistorySection } from './company-history'
import { CompanyJobsCard } from './company-jobs-card'
import type { CompanyBase, CompanyDetail } from './types'

function CompanySkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <SectionSkeleton rows={4} />
          <SectionSkeleton rows={5} />
        </div>
        <div className="flex flex-col gap-6">
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={3} />
        </div>
      </div>
    </div>
  )
}

/** Blacklist or restore the company, with a confirmation first. */
function BlacklistButton({ company }: { company: CompanyBase }) {
  const [open, setOpen] = useState(false)
  const toggle = useApiMutation<{ blacklisted: boolean }, CompanyBase>((body) => api.patch(`/api/companies/${company.id}`, body), {
    invalidate: [['companies'], ['jobs']],
    successMessage: (d) => (d.blacklisted ? 'Company blacklisted' : 'Company restored'),
  })
  if (company.blacklisted)
    return (
      <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate({ blacklisted: false })}>
        <Undo2 className="size-3.5" /> Remove from blacklist
      </Button>
    )
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger-text" onClick={() => setOpen(true)}>
        <Ban className="size-3.5" /> Blacklist
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blacklist {company.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its future postings are ignored and no batch applies to it. You can undo this here.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={toggle.isPending} onClick={() => toggle.mutateAsync({ blacklisted: true }).then(() => setOpen(false)).catch(() => null)}>
              Blacklist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function CompanyDetailView({ id }: { id: string }) {
  const query = useApiQuery<CompanyDetail>(['companies', id], `/api/companies/${id}`)

  if (query.isPending) return <CompanySkeleton />
  if (query.isError) {
    const notFound = query.error.status === 404
    return (
      <EmptyState
        icon={<SearchX />}
        title={notFound ? 'Company not found' : 'Could not load this company'}
        description={notFound ? 'It may have been removed, or the link is wrong.' : query.error.message}
        action={
          notFound ? (
            <Button variant="outline" nativeButton={false} render={<Link href="/companies" />}>
              <ArrowLeft className="size-4" /> Back to companies
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          )
        }
      />
    )
  }

  const company = query.data.data
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={company.name}
        meta={
          <>
            {company.domain ? (
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer noopener" className="font-medium text-primary-text hover:underline">
                {company.domain}
              </a>
            ) : null}
            {company.countryCode ? (
              <span>
                {flagEmoji(company.countryCode)} {countryName(company.countryCode)}
              </span>
            ) : null}
            <span className="tabular-nums">{fmtNumber(company._count.jobs)} jobs</span>
            <span>Added {fmtDate(company.createdAt)}</span>
          </>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {company.knownSponsor ? <ToneBadge tone="success">Known sponsor</ToneBadge> : <ToneBadge tone="muted">Sponsor unknown</ToneBadge>}
          {company.blacklisted ? <ToneBadge tone="danger">Blacklisted</ToneBadge> : null}
          {company.atsType ? <ToneBadge tone="neutral">{titleCase(company.atsType)} board</ToneBadge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" nativeButton={false} render={<a href="#profile" aria-label="Edit company" />}>
            <Pencil className="size-3.5" /> Edit
          </Button>
          {company.careersUrl ? (
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={company.careersUrl} target="_blank" rel="noreferrer noopener" aria-label="Careers page" />}>
              <ExternalLink className="size-3.5" /> Careers
            </Button>
          ) : null}
          <BlacklistButton company={company} />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <CompanyHistorySection companyId={company.id} />
          <CompanyJobsCard companyId={company.id} jobs={company.jobs} total={company._count.jobs} />
          <CompanyEditForm key={company.updatedAt} company={company} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          <CompanyContactCard company={company} />
          <CompanyFetchCard company={company} />
        </aside>
      </div>
    </div>
  )
}
