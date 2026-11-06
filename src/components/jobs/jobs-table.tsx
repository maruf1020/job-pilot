'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { EyeOff, FileText, RefreshCw, Send, SkipForward } from 'lucide-react'
import { DataTable, type BulkAction, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { Segmented } from '@/components/shared/filter-bar'
import { AppStatusBadge, ChannelBadge, JobStatusBadge, ScoreBadge, SponsorshipBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { useHydrated } from '@/hooks/use-hydrated'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { APPLY_CHANNELS, JOB_STATUSES, SOURCE_IDS, SOURCE_LABELS, SPONSORSHIP_LEVELS, countryName } from '@/lib/domain'
import { JOB_STATUS_LABEL, SPONSORSHIP_LABEL, flagEmoji, fmtAgo, fmtDate, fmtNumber, scoreTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CHANNEL_LABELS, type JobRow } from './types'

type BulkJobAction = 'draft-and-queue' | 'draft' | 'skip' | 'rescore'
export type JobView = 'fit' | 'new' | 'applied' | 'all'

/** "Fit" = the score the browser batch starts from (plan-apply-all.md). */
export const FIT_SCORE = 60

const FILTERS: DataTableFilter[] = [
  { key: 'status', label: 'Status', type: 'select', options: JOB_STATUSES.map((s) => ({ value: s, label: JOB_STATUS_LABEL[s].label })) },
  { key: 'country', label: 'Country', type: 'text', placeholder: 'e.g. DE' },
  { key: 'sponsorship', label: 'Sponsorship', type: 'select', options: SPONSORSHIP_LEVELS.map((s) => ({ value: s, label: SPONSORSHIP_LABEL[s].label })) },
  { key: 'source', label: 'Source', type: 'select', options: SOURCE_IDS.map((s) => ({ value: s, label: SOURCE_LABELS[s] })) },
  { key: 'channel', label: 'Channel', type: 'select', options: APPLY_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] ?? c })) },
  { key: 'score[gte]', label: 'Min score', type: 'number', placeholder: '0-100' },
  { key: 'remote', label: 'Remote', type: 'boolean' },
  { key: 'seenSince[gte]', label: 'Seen since', type: 'date' },
]

function place(row: Pick<JobRow, 'location' | 'countryCode' | 'remote'>): string {
  const parts = [row.location ?? (row.countryCode ? countryName(row.countryCode) : null), row.remote ? 'Remote' : null].filter(Boolean)
  return parts.join(' · ')
}

/** One status per row: the application's when there is one (that is what moves), else the job's. */
function RowStatus({ row }: { row: JobRow }) {
  return row.application ? <AppStatusBadge status={row.application.status} /> : <JobStatusBadge status={row.status} />
}

const COLUMNS: DataTableColumn<JobRow>[] = [
  {
    key: 'score',
    header: 'Score',
    sortKey: 'score',
    className: 'w-16',
    cell: (row) => <ScoreBadge score={row.score?.finalScore} />,
  },
  {
    key: 'title',
    header: 'Job',
    sortKey: 'title',
    className: 'w-full min-w-0 max-w-0',
    cell: (row) => (
      <div className="min-w-0">
        <Link href={`/jobs/${row.id}`} className="block truncate font-medium text-foreground hover:underline">
          {row.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{row.companyName}</span>
          {row.countryCode ? (
            <span title={countryName(row.countryCode)}>
              {' '}
              · {flagEmoji(row.countryCode)} {place(row)}
            </span>
          ) : place(row) ? (
            ` · ${place(row)}`
          ) : null}
        </p>
      </div>
    ),
  },
  { key: 'sponsorship', header: 'Sponsorship', sortKey: 'sponsorship', hideBelow: 'lg', cell: (row) => <SponsorshipBadge level={row.sponsorship} /> },
  { key: 'channel', header: 'Channel', hideBelow: 'xl', cell: (row) => <ChannelBadge channel={row.applyChannel} /> },
  {
    key: 'posted',
    header: 'Posted',
    sortKey: 'postedAt',
    hideBelow: 'md',
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDate(row.postedAt ?? row.firstSeenAt)}>
        {fmtAgo(row.postedAt ?? row.firstSeenAt)}
      </span>
    ),
  },
  { key: 'status', header: 'Status', sortKey: 'status', cell: (row) => <RowStatus row={row} /> },
]

const SCORE_SQUARE: Record<string, string> = {
  success: 'bg-success-soft text-success-text',
  accent: 'bg-primary-soft text-primary-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger-text',
  muted: 'bg-muted text-muted-foreground',
}

function JobMobileCard({ row }: { row: JobRow }) {
  const score = row.score?.finalScore
  return (
    <div className="flex items-start gap-3">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums', SCORE_SQUARE[scoreTone(score)] ?? SCORE_SQUARE.muted)}>{score ?? '-'}</span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{row.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.companyName}
          {row.countryCode ? ` · ${flagEmoji(row.countryCode)} ${row.countryCode}` : ''}
          {row.remote ? ' · Remote' : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RowStatus row={row} />
          <SponsorshipBadge level={row.sponsorship} />
          <span className="text-xs text-muted-foreground">{fmtAgo(row.postedAt ?? row.firstSeenAt)}</span>
        </div>
      </div>
    </div>
  )
}

/** The date a week ago (day precision, so query keys stay stable for the day). */
function weekAgo(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
}

/** Totals for the quick views and the page summary (cheap: one row each, the API counts). */
export function useJobCounts() {
  const [since] = useState(weekAgo)
  const fit = useApiQuery<JobRow[]>(['jobs', 'count', 'fit'], `/api/jobs?pageSize=1&filter[score][gte]=${FIT_SCORE}`)
  const fresh = useApiQuery<JobRow[]>(['jobs', 'count', 'new'], `/api/jobs?pageSize=1&filter[seenSince][gte]=${since}`)
  const applied = useApiQuery<JobRow[]>(['jobs', 'count', 'applied'], '/api/jobs?pageSize=1&filter[status]=APPLIED')
  const all = useApiQuery<JobRow[]>(['jobs', 'count', 'all'], '/api/jobs?pageSize=1')
  const hydrated = useHydrated()
  const n = (q: typeof all) => (hydrated ? q.data?.meta?.total : undefined)
  return { since, fit: n(fit), new: n(fresh), applied: n(applied), all: n(all) }
}

/** "N jobs in the pipeline · M fit · K new this week": the Jobs page description. */
export function JobsSummary() {
  const c = useJobCounts()
  if (c.all === undefined) return <span>Every role the search found, ranked by fit.</span>
  return (
    <span>
      {fmtNumber(c.all)} jobs in the pipeline{c.fit !== undefined ? ` · ${fmtNumber(c.fit)} fit (score ${FIT_SCORE}+)` : ''}
      {c.new !== undefined ? ` · ${fmtNumber(c.new)} new this week` : ''}
    </span>
  )
}

/** Quick views read and write the same URL the table uses, so links and the back button keep them. */
function useJobView() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const filterKeys = [...sp.keys()].filter((k) => k.startsWith('filter['))
  const status = sp.get('filter[status]')
  let view: JobView
  if (status === 'APPLIED') view = 'applied'
  else if (sp.get('filter[seenSince][gte]')) view = 'new'
  else if (filterKeys.length === 0 && sp.get('view') !== 'all') view = 'fit'
  else view = 'all'

  const go = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(sp.toString())
    next.delete('page')
    mutate(next)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const setView = (v: JobView) =>
    go((next) => {
      for (const k of [...next.keys()]) if (k.startsWith('filter[') || k === 'view') next.delete(k)
      if (v === 'new') next.set('filter[seenSince][gte]', weekAgo())
      if (v === 'applied') next.set('filter[status]', 'APPLIED')
      if (v === 'all') next.set('view', 'all')
    })
  const showFiltered = () =>
    go((next) => {
      for (const k of [...next.keys()]) if (k.startsWith('filter[')) next.delete(k)
      next.set('view', 'all')
      next.set('filter[status]', 'FILTERED')
    })
  return { view, setView, showFiltered, hasStatusFilter: Boolean(status) }
}

export function JobsTable() {
  const { view, setView, showFiltered, hasStatusFilter } = useJobView()
  const counts = useJobCounts()
  const bulk = useApiMutation<{ ids: string[]; action: BulkJobAction }, { affected: number }>((vars) => api.post('/api/jobs/bulk', vars), {
    invalidate: [['jobs']],
    // The route returns an action-specific message (e.g. for draft-and-queue); fall back to a count.
    successMessage: (data, env) => (env.message && env.message !== 'OK' ? env.message : `${data.affected} job${data.affected === 1 ? '' : 's'} updated`),
  })

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      { label: 'Draft & queue', icon: <Send className="size-3.5" />, variant: 'default', onAction: (ids) => bulk.mutateAsync({ ids, action: 'draft-and-queue' }) },
      { label: 'Draft', icon: <FileText className="size-3.5" />, onAction: (ids) => bulk.mutateAsync({ ids, action: 'draft' }) },
      { label: 'Skip', icon: <SkipForward className="size-3.5" />, onAction: (ids) => bulk.mutateAsync({ ids, action: 'skip' }) },
      { label: 'Rescore', icon: <RefreshCw className="size-3.5" />, onAction: (ids) => bulk.mutateAsync({ ids, action: 'rescore' }) },
    ],
    // mutateAsync is stable for the lifetime of the mutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // The default view sends the fit threshold without putting it in the URL, so "Clear all" on other filters works as expected.
  const extraParams = useMemo(() => (view === 'fit' ? { 'filter[score][gte]': String(FIT_SCORE) } : undefined), [view])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<JobView>
          value={view}
          onChange={setView}
          options={[
            { value: 'fit', label: `Fit ${FIT_SCORE}+`, count: counts.fit },
            { value: 'new', label: 'New this week', count: counts.new },
            { value: 'applied', label: 'Applied', count: counts.applied },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        {!hasStatusFilter ? (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={showFiltered} title="Filtered and rule-excluded jobs are hidden unless you pick a status">
            <EyeOff className="size-3.5" /> Show filtered out
          </Button>
        ) : null}
      </div>
      <DataTable<JobRow>
        endpoint="/api/jobs"
        queryKey="jobs"
        columns={COLUMNS}
        filters={FILTERS}
        defaultSort="-score"
        extraParams={extraParams}
        rowHref={(row) => `/jobs/${row.id}`}
        bulkActions={bulkActions}
        renderMobileCard={(row) => <JobMobileCard row={row} />}
        searchPlaceholder="Search title, company, location…"
        emptyTitle={view === 'fit' ? `No jobs score ${FIT_SCORE} or more yet` : view === 'new' ? 'Nothing new this week' : 'No jobs match'}
        emptyDescription={
          view === 'applied'
            ? 'Applications sent by email, by the browser agent or marked by hand show here.'
            : 'Filtered and rule-excluded jobs are hidden unless you pick a status. Widen the filters or run a search from Runs.'
        }
      />
    </div>
  )
}
