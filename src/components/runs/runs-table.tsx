'use client'

import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { api, useApiMutation } from '@/lib/api/hooks'
import { RUN_STATUSES, RUN_TRIGGERS, SOURCE_IDS, SOURCE_LABELS, type SourceId } from '@/lib/domain'
import { fmtDateTime, fmtDuration, fmtNumber, RUN_STATUS_LABEL, titleCase } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn, type DataTableFilter } from '@/components/data-table/data-table'
import { RunStatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useStatus } from '@/components/layout/status-chip'
import { StopRunButton } from './stop-run-button'
import type { RunRow } from './types'

/** Toolbar: "Stop run" while one is in progress, plus "Run now". */
function RunToolbar() {
  const { data } = useStatus()
  const running = data?.data.running
  return (
    <>
      {running ? <StopRunButton runId={running.id} /> : null}
      <RunNowButton />
    </>
  )
}

interface TriggerRunBody {
  sources?: SourceId[]
  skipDrafts?: boolean
}

interface TriggerRunResult {
  queued?: boolean
  runId?: string
  alreadyRunning?: boolean
}

const FILTERS: DataTableFilter[] = [
  { key: 'status', label: 'Status', type: 'select', options: RUN_STATUSES.map((s) => ({ value: s, label: RUN_STATUS_LABEL[s].label })) },
  { key: 'trigger', label: 'Trigger', type: 'select', options: RUN_TRIGGERS.map((t) => ({ value: t, label: titleCase(t) })) },
]

function Num({ value, warn }: { value: number; warn?: boolean }) {
  return <span className={cn('tabular-nums', warn && value > 0 && 'font-medium text-danger-text', value === 0 && 'text-muted-foreground')}>{fmtNumber(value)}</span>
}

const COLUMNS: DataTableColumn<RunRow>[] = [
  { key: 'startedAt', header: 'Started', sortKey: 'startedAt', cell: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</span> },
  { key: 'trigger', header: 'Trigger', cell: (r) => <span className="text-muted-foreground">{titleCase(r.trigger)}</span> },
  { key: 'status', header: 'Status', sortKey: 'status', cell: (r) => <RunStatusBadge status={r.status} /> },
  { key: 'duration', header: 'Duration', sortKey: 'durationMs', hideBelow: 'lg', cell: (r) => <span className="tabular-nums text-muted-foreground">{fmtDuration(r.durationMs)}</span> },
  { key: 'fetched', header: 'Fetched', sortKey: 'totalFetched', align: 'right', hideBelow: 'lg', cell: (r) => <Num value={r.totalFetched} /> },
  { key: 'new', header: 'New', sortKey: 'totalNew', align: 'right', cell: (r) => <Num value={r.totalNew} /> },
  { key: 'ranked', header: 'Ranked', align: 'right', hideBelow: 'lg', cell: (r) => <Num value={r.totalRanked} /> },
  { key: 'drafted', header: 'Drafted', align: 'right', cell: (r) => <Num value={r.totalDrafted} /> },
  { key: 'queued', header: 'Queued', align: 'right', hideBelow: 'xl', cell: (r) => <Num value={r.totalQueued} /> },
  { key: 'errors', header: 'Errors', align: 'right', cell: (r) => <Num value={r.errorCount} warn /> },
]

function RunNowButton() {
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<Set<SourceId>>(new Set())
  const [skipDrafts, setSkipDrafts] = useState(false)

  const start = useApiMutation<TriggerRunBody, TriggerRunResult>((body) => api.post<TriggerRunResult>('/api/runs', body), {
    invalidate: [['runs'], ['status']],
    onSuccess: () => setOpen(false),
  })

  const toggleSource = (id: SourceId, on: boolean) => {
    setSources((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="sm" />}>
        <Play className="size-3.5" /> Run now
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-1.5rem)] max-w-80">
        <PopoverHeader>
          <PopoverTitle>Start a search run</PopoverTitle>
          <PopoverDescription>Leave every source unticked to use all enabled sources.</PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-1">
          {SOURCE_IDS.map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
              <Checkbox checked={sources.has(id)} onCheckedChange={(c) => toggleSource(id, c)} />
              <span className="truncate">{SOURCE_LABELS[id]}</span>
            </label>
          ))}
        </div>
        <Separator />
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
          <Checkbox checked={skipDrafts} onCheckedChange={(c) => setSkipDrafts(c)} />
          <span>
            Skip drafting
            <span className="block text-xs text-muted-foreground">Fetch, enrich and rank only; no email drafts.</span>
          </span>
        </label>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSources(new Set())} disabled={sources.size === 0}>
            Clear
          </Button>
          <Button size="sm" disabled={start.isPending} onClick={() => start.mutate({ sources: sources.size > 0 ? [...sources] : undefined, skipDrafts: skipDrafts || undefined })}>
            {start.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Start
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MobileCard({ row }: { row: RunRow }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{fmtDateTime(row.startedAt)}</span>
        <RunStatusBadge status={row.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {titleCase(row.trigger)} · {fmtDuration(row.durationMs)} · {row._count.sources} sources
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        <span>
          <span className="text-muted-foreground">fetched</span> <Num value={row.totalFetched} />
        </span>
        <span>
          <span className="text-muted-foreground">new</span> <Num value={row.totalNew} />
        </span>
        <span>
          <span className="text-muted-foreground">ranked</span> <Num value={row.totalRanked} />
        </span>
        <span>
          <span className="text-muted-foreground">drafted</span> <Num value={row.totalDrafted} />
        </span>
        <span>
          <span className="text-muted-foreground">queued</span> <Num value={row.totalQueued} />
        </span>
        <span>
          <span className="text-muted-foreground">errors</span> <Num value={row.errorCount} warn />
        </span>
      </p>
    </div>
  )
}

export function RunsTable() {
  return (
    <DataTable<RunRow>
      endpoint="/api/runs"
      queryKey="runs"
      columns={COLUMNS}
      filters={FILTERS}
      defaultSort="-startedAt"
      rowHref={(r) => `/runs/${r.id}`}
      refetchInterval={10_000}
      renderMobileCard={(row) => <MobileCard row={row} />}
      toolbarExtra={<RunToolbar />}
      searchPlaceholder="Runs are not searchable"
      emptyTitle="No runs yet"
      emptyDescription="Start one with Run now, or wait for the schedule."
    />
  )
}
