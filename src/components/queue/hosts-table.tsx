'use client'

import { ExternalLink, LogIn, LogOut, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react'
import { useTableQuery } from '@/hooks/use-table-query'
import { api, useApiMutation } from '@/lib/api/hooks'
import { fmtAgo, fmtDate, fmtNumber, titleCase, type BadgeTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Segmented } from '@/components/shared/filter-bar'
import { ToneBadge } from '@/components/shared/status-badge'

export interface HostRow {
  id: string
  host: string
  kind: string
  atsType: string | null
  attempts: number
  submitted: number
  needsHuman: number
  failed: number
  failStreak: number
  lastOutcome: string | null
  lastReason: string | null
  skipUntil: string | null
  loggedIn: boolean
  updatedAt: string
}

// Same list as HOST_KINDS in lib/apply/hosts.ts, which cannot be imported here (it loads the database client).
const HOST_KINDS = ['direct-form', 'ats-embed', 'needs-account', 'sign-in-wall', 'talent-community', 'external-redirect', 'bot-wall', 'captcha', 'no-form', 'closed', 'unknown'] as const

const KIND_TONE: Record<string, BadgeTone> = {
  'direct-form': 'success',
  'ats-embed': 'success',
  'needs-account': 'warning',
  'sign-in-wall': 'warning',
  captcha: 'warning',
  'bot-wall': 'danger',
  'talent-community': 'muted',
  'no-form': 'muted',
  closed: 'muted',
  'external-redirect': 'info',
  unknown: 'neutral',
}

const FILTERS: DataTableFilter[] = [
  { key: 'kind', label: 'Kind', type: 'select', options: HOST_KINDS.map((k) => ({ value: k, label: titleCase(k.replace(/-/g, ' ')) })) },
  { key: 'skipped', label: 'Skipped now', type: 'boolean' },
  { key: 'loggedIn', label: 'You signed in', type: 'boolean' },
]

/** Quick views over the table's URL filters (plan-ui-redesign.md 6, Hosts). */
type View = 'all' | 'skipped' | 'sign-in' | 'working'
const VIEW_FILTERS: Record<View, Record<string, string>> = {
  all: {},
  skipped: { skipped: 'true' },
  'sign-in': { 'kind[in]': 'needs-account,sign-in-wall' },
  working: { 'kind[in]': 'direct-form,ats-embed' },
}
const VIEW_KEYS = ['skipped', 'kind', 'kind[in]']

function successPct(r: HostRow): number | null {
  return r.attempts ? Math.round((r.submitted / r.attempts) * 100) : null
}

function isSkipped(r: HostRow): boolean {
  return !!r.skipUntil && new Date(r.skipUntil) > new Date()
}

function SuccessBar({ row }: { row: HostRow }) {
  const p = successPct(row)
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        {p !== null ? <div className={cn('h-full rounded-full', p >= 60 ? 'bg-success' : p >= 25 ? 'bg-warning' : 'bg-destructive')} style={{ width: `${Math.max(3, p)}%` }} /> : null}
      </div>
      <span className="w-10 text-right tabular-nums">{p === null ? '-' : `${p}%`}</span>
    </div>
  )
}

function HostActions({ row }: { row: HostRow }) {
  const act = useApiMutation<{ action: string }, unknown>((v) => api.post('/api/hosts', { host: row.host, ...v }), { invalidate: [['hosts'], ['queue']] })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${row.host}`} disabled={act.isPending} data-no-row-click>
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52" data-no-row-click>
        <DropdownMenuItem onClick={() => window.open(`https://${row.host}`, '_blank', 'noopener,noreferrer')}>
          <ExternalLink className="size-4" /> Open site
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {row.loggedIn ? (
          <DropdownMenuItem onClick={() => act.mutate({ action: 'logged-out' })}>
            <LogOut className="size-4" /> Not signed in after all
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => act.mutate({ action: 'logged-in' })}>
            <LogIn className="size-4" /> I signed in
          </DropdownMenuItem>
        )}
        {isSkipped(row) ? (
          <DropdownMenuItem onClick={() => act.mutate({ action: 'clear-skip' })}>
            <PlayCircle className="size-4" /> Clear skip
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => act.mutate({ action: 'skip-week' })}>
            <PauseCircle className="size-4" /> Skip a week
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function KindBadge({ kind }: { kind: string }) {
  return <ToneBadge tone={KIND_TONE[kind] ?? 'neutral'}>{titleCase(kind.replace(/-/g, ' '))}</ToneBadge>
}

function StateBadges({ row }: { row: HostRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {isSkipped(row) ? <ToneBadge tone="muted">Skipped until {fmtDate(row.skipUntil)}</ToneBadge> : null}
      {row.loggedIn ? <ToneBadge tone="success">Signed in</ToneBadge> : null}
      {row.failStreak > 1 ? <ToneBadge tone="warning">{row.failStreak} fails in a row</ToneBadge> : null}
      {!isSkipped(row) && !row.loggedIn && row.failStreak <= 1 ? <span className="text-xs text-muted-foreground">{fmtAgo(row.updatedAt)}</span> : null}
    </div>
  )
}

const COLUMNS: DataTableColumn<HostRow>[] = [
  {
    key: 'host',
    header: 'Host',
    sortKey: 'host',
    cell: (r) => (
      <div className="min-w-0 max-w-64">
        <p className="truncate font-mono text-xs font-medium" title={r.host}>
          {r.host}
        </p>
        {r.atsType ? <p className="text-xs text-muted-foreground">{titleCase(r.atsType)}</p> : null}
      </div>
    ),
  },
  { key: 'kind', header: 'Kind', sortKey: 'kind', cell: (r) => <KindBadge kind={r.kind} /> },
  { key: 'attempts', header: 'Tries', sortKey: 'attempts', align: 'right', cell: (r) => <span className="tabular-nums">{fmtNumber(r.attempts)}</span> },
  { key: 'submitted', header: 'Submitted', sortKey: 'submitted', align: 'right', hideBelow: 'md', cell: (r) => <span className="tabular-nums">{fmtNumber(r.submitted)}</span> },
  { key: 'success', header: 'Success', align: 'right', cell: (r) => <SuccessBar row={r} /> },
  {
    key: 'reason',
    header: 'Last stop',
    hideBelow: 'xl',
    cell: (r) => (
      <p className="line-clamp-2 max-w-xs text-xs text-muted-foreground" title={r.lastReason ?? undefined}>
        {r.lastReason ?? '-'}
      </p>
    ),
  },
  { key: 'state', header: 'State', sortKey: 'skipUntil', hideBelow: 'lg', cell: (r) => <StateBadges row={r} /> },
  { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: (r) => <HostActions row={r} /> },
]

function HostMobileCard({ row }: { row: HostRow }) {
  const p = successPct(row)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-mono text-xs font-medium break-all">{row.host}</p>
        <div className="flex shrink-0 items-center gap-1">
          <KindBadge kind={row.kind} />
          <HostActions row={row} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {fmtNumber(row.submitted)} of {fmtNumber(row.attempts)} submitted{p === null ? '' : ` · ${p}%`}
      </p>
      <StateBadges row={row} />
      {row.lastReason ? <p className="line-clamp-2 text-xs text-muted-foreground">{row.lastReason}</p> : null}
    </div>
  )
}

/** Quick views: All / Skipped / Needs sign-in / Working, kept in the table's URL filters. */
export function HostViews() {
  const { state, update } = useTableQuery({ pageSize: 20, sort: '-attempts' })
  const f = state.filters
  const view: View = f.skipped === 'true' ? 'skipped' : f['kind[in]'] === VIEW_FILTERS['sign-in']['kind[in]'] ? 'sign-in' : f['kind[in]'] === VIEW_FILTERS.working['kind[in]'] ? 'working' : 'all'
  return (
    <Segmented<View>
      value={view}
      onChange={(v) => {
        const rest = Object.fromEntries(Object.entries(f).filter(([k]) => !VIEW_KEYS.includes(k)))
        update({ filters: { ...rest, ...VIEW_FILTERS[v] } }, { resetPage: true })
      }}
      options={[
        { value: 'all', label: 'All' },
        { value: 'skipped', label: 'Skipped' },
        { value: 'sign-in', label: 'Needs sign-in' },
        { value: 'working', label: 'Working' },
      ]}
    />
  )
}

/** What the agent learned per website: kind of page, success, and whether batches skip it. */
export function HostsTable() {
  return (
    <DataTable<HostRow>
      endpoint="/api/hosts"
      queryKey="hosts"
      columns={COLUMNS}
      filters={FILTERS}
      defaultSort="-attempts"
      renderMobileCard={(row) => <HostMobileCard row={row} />}
      searchPlaceholder="Search host or reason"
      emptyTitle="No hosts here"
      emptyDescription="Every finished browser attempt records its website: what kind of page it is, how often forms there end submitted, and whether batches skip it for a while."
    />
  )
}
