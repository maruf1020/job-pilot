'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { Segmented } from '@/components/shared/filter-bar'
import { ToneBadge } from '@/components/shared/status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHydrated } from '@/hooks/use-hydrated'
import { useApiQuery } from '@/lib/api/hooks'
import { ATS_TYPES, countryName } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDate, fmtNumber, titleCase } from '@/lib/format'
import { AddCompanyDialog } from './add-company-dialog'
import type { CompanyRow } from './types'

type CompanyView = 'all' | 'sponsors' | 'boards' | 'matching' | 'blacklisted'

const VIEW_FILTER: Record<Exclude<CompanyView, 'all'>, string> = {
  sponsors: 'filter[knownSponsor]',
  boards: 'filter[hasAts]',
  matching: 'filter[hasMatching]',
  blacklisted: 'filter[blacklisted]',
}

const FILTERS: DataTableFilter[] = [
  { key: 'knownSponsor', label: 'Known sponsor', type: 'boolean' },
  { key: 'blacklisted', label: 'Blacklisted', type: 'boolean' },
  { key: 'atsType', label: 'ATS', type: 'select', options: ATS_TYPES.map((t) => ({ value: t, label: titleCase(t) })) },
  { key: 'hasAts', label: 'Has ATS board', type: 'boolean' },
  { key: 'hasMatching', label: 'Board with matching jobs', type: 'boolean' },
  { key: 'country', label: 'Country', type: 'text', placeholder: 'e.g. NL' },
]

/** The ATS board: type, slug and how it was found, with the last read (red when it failed). */
function BoardCell({ row }: { row: CompanyRow }) {
  if (!row.atsType) return <span className="text-xs text-muted-foreground">-</span>
  const read = row.lastFetchedAt ? `read ${fmtAgo(row.lastFetchedAt)}` : 'not read yet'
  return (
    <div className="min-w-0 text-xs">
      <p className="truncate">
        <span className="font-medium text-foreground">{titleCase(row.atsType)}</span>
        {row.atsSlug ? <span className="font-mono text-muted-foreground"> {row.atsSlug}</span> : null}
      </p>
      {row.lastFetchError ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex items-center gap-1 text-danger-text" />}>
            <AlertCircle className="size-3" /> failed, {read}
          </TooltipTrigger>
          <TooltipContent className="max-w-sm wrap-break-word">{row.lastFetchError}</TooltipContent>
        </Tooltip>
      ) : (
        <p className="text-muted-foreground">{read}</p>
      )}
    </div>
  )
}

/** Jobs on the board that match your search rules, counted when the board was found or last re-counted. */
function MatchingCell({ row }: { row: CompanyRow }) {
  if (!row.atsType) return <span className="text-xs text-muted-foreground">-</span>
  const n = row.boardMatchingJobs
  if (n === null || n === undefined) return <span className="text-xs text-muted-foreground">not counted</span>
  return (
    <span title={row.boardMatchedAt ? `counted ${fmtAgo(row.boardMatchedAt)}` : undefined} className={n > 0 ? 'font-medium tabular-nums text-success-text' : 'tabular-nums text-muted-foreground'}>
      {fmtNumber(n)}
    </span>
  )
}

const COLUMNS: DataTableColumn<CompanyRow>[] = [
  {
    key: 'name',
    header: 'Company',
    sortKey: 'name',
    className: 'w-full min-w-0 max-w-0',
    cell: (row) => (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={`/companies/${row.id}`} className="truncate font-medium text-foreground hover:underline">
            {row.name}
          </Link>
          {row.blacklisted ? <ToneBadge tone="danger">Blacklisted</ToneBadge> : null}
        </div>
        {row.domain ? <p className="truncate text-xs text-muted-foreground">{row.domain}</p> : null}
      </div>
    ),
  },
  {
    key: 'country',
    header: 'Country',
    sortKey: 'countryCode',
    hideBelow: 'md',
    cell: (row) => (
      <span title={countryName(row.countryCode)} className="whitespace-nowrap">
        {flagEmoji(row.countryCode)} {row.countryCode ?? '-'}
      </span>
    ),
  },
  {
    key: 'sponsor',
    header: 'Sponsor',
    sortKey: 'knownSponsor',
    hideBelow: 'md',
    cell: (row) => (row.knownSponsor ? <ToneBadge tone="success">Known</ToneBadge> : <span className="text-xs text-muted-foreground">Unknown</span>),
  },
  { key: 'ats', header: 'ATS board', hideBelow: 'lg', className: 'max-w-56', cell: (row) => <BoardCell row={row} /> },
  {
    key: 'matching',
    header: 'Matching jobs',
    sortKey: 'boardMatchingJobs',
    align: 'right',
    hideBelow: 'lg',
    cell: (row) => <MatchingCell row={row} />,
  },
  { key: 'jobs', header: 'Jobs', align: 'right', cell: (row) => <span className="tabular-nums">{fmtNumber(row._count.jobs)}</span> },
  {
    key: 'applied',
    header: 'Applied',
    align: 'right',
    cell: (row) => <span className={row.applications?.count ? 'font-medium tabular-nums text-foreground' : 'tabular-nums text-muted-foreground'}>{fmtNumber(row.applications?.count ?? 0)}</span>,
  },
  {
    key: 'lastApplied',
    header: 'Last applied',
    hideBelow: 'xl',
    cell: (row) =>
      row.applications?.lastSentAt ? (
        <span className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDate(row.applications.lastSentAt)}>
          {fmtAgo(row.applications.lastSentAt)}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
  },
]

function CompanyMobileCard({ row }: { row: CompanyRow }) {
  const applied = row.applications?.count ?? 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{row.name}</p>
          {row.domain ? <p className="truncate text-xs text-muted-foreground">{row.domain}</p> : null}
        </div>
        <span className="shrink-0 text-sm whitespace-nowrap">
          {flagEmoji(row.countryCode)} {row.countryCode ?? ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.knownSponsor ? <ToneBadge tone="success">Known sponsor</ToneBadge> : null}
        {row.blacklisted ? <ToneBadge tone="danger">Blacklisted</ToneBadge> : null}
        {row.atsType ? <ToneBadge tone="neutral">{titleCase(row.atsType)}</ToneBadge> : null}
        {row.lastFetchError ? <ToneBadge tone="danger">Board failed</ToneBadge> : null}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {fmtNumber(row._count.jobs)} job{row._count.jobs === 1 ? '' : 's'} · {applied ? `${fmtNumber(applied)} applied, last ${fmtAgo(row.applications?.lastSentAt)}` : 'not applied yet'}
      </p>
    </div>
  )
}

/** Counts for the quick views and the page description. */
export function useCompanyCounts() {
  const all = useApiQuery<CompanyRow[]>(['companies', 'count', 'all'], '/api/companies?pageSize=1')
  const sponsors = useApiQuery<CompanyRow[]>(['companies', 'count', 'sponsors'], '/api/companies?pageSize=1&filter[knownSponsor]=true')
  const boards = useApiQuery<CompanyRow[]>(['companies', 'count', 'boards'], '/api/companies?pageSize=1&filter[hasAts]=true')
  const matching = useApiQuery<CompanyRow[]>(['companies', 'count', 'matching'], '/api/companies?pageSize=1&filter[hasMatching]=true')
  const blacklisted = useApiQuery<CompanyRow[]>(['companies', 'count', 'blacklisted'], '/api/companies?pageSize=1&filter[blacklisted]=true')
  const hydrated = useHydrated()
  const n = (q: typeof all) => (hydrated ? q.data?.meta?.total : undefined)
  return { all: n(all), sponsors: n(sponsors), boards: n(boards), matching: n(matching), blacklisted: n(blacklisted) }
}

/** "N companies · M known sponsors · K with an ATS board": the Companies page description. */
export function CompaniesSummary() {
  const c = useCompanyCounts()
  if (c.all === undefined) return <span>Employers seen across your searches.</span>
  return (
    <span>
      {fmtNumber(c.all)} employers seen in your searches{c.sponsors !== undefined ? ` · ${fmtNumber(c.sponsors)} known sponsors` : ''}
      {c.boards !== undefined ? ` · ${fmtNumber(c.boards)} with an ATS board` : ''}
    </span>
  )
}

function useCompanyView() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view: CompanyView = sp.get(VIEW_FILTER.sponsors) === 'true' ? 'sponsors' : sp.get(VIEW_FILTER.boards) === 'true' ? 'boards' : sp.get(VIEW_FILTER.matching) === 'true' ? 'matching' : sp.get(VIEW_FILTER.blacklisted) === 'true' ? 'blacklisted' : 'all'
  const setView = (v: CompanyView) => {
    const next = new URLSearchParams(sp.toString())
    next.delete('page')
    for (const k of Object.values(VIEW_FILTER)) next.delete(k)
    if (v !== 'all') next.set(VIEW_FILTER[v], 'true')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  return { view, setView }
}

export function CompaniesTable() {
  const { view, setView } = useCompanyView()
  const counts = useCompanyCounts()
  return (
    <div className="flex flex-col gap-3">
      <Segmented<CompanyView>
        className="self-start"
        value={view}
        onChange={setView}
        options={[
          { value: 'all', label: 'All', count: counts.all },
          { value: 'sponsors', label: 'Known sponsors', count: counts.sponsors },
          { value: 'boards', label: 'With ATS board', count: counts.boards },
          { value: 'matching', label: 'Boards with matching jobs', count: counts.matching },
          { value: 'blacklisted', label: 'Blacklisted', count: counts.blacklisted },
        ]}
      />
      <DataTable<CompanyRow>
        endpoint="/api/companies"
        queryKey="companies"
        columns={COLUMNS}
        filters={FILTERS}
        defaultSort="name"
        rowHref={(row) => `/companies/${row.id}`}
        renderMobileCard={(row) => <CompanyMobileCard row={row} />}
        searchPlaceholder="Search name or domain…"
        toolbarExtra={<AddCompanyDialog />}
        emptyTitle="No companies match"
        emptyDescription="Companies appear automatically as jobs are found. Add one by hand to track its ATS board."
      />
    </div>
  )
}
