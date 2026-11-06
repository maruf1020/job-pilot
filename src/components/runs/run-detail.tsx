'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { ArrowLeft, ChevronDown, Loader2 } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import { countryName, SOURCE_LABELS, type SourceId } from '@/lib/domain'
import { flagEmoji, fmtAgo, fmtDateTime, fmtDuration, fmtNumber, titleCase, toDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState, Metric, PageHeader } from '@/components/shared/page-header'
import { Section } from '@/components/shared/section'
import { MetricsSkeleton, SectionSkeleton } from '@/components/shared/skeletons'
import { Segmented } from '@/components/shared/filter-bar'
import { RunStatusBadge, ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StopRunButton } from './stop-run-button'
import { parseErrorDetails, type RunDetailPayload, type RunLog, type RunSource } from './types'

const LOG_LIMIT = 1000

const LEVEL_CLASS: Record<string, string> = {
  error: 'text-danger-text',
  warn: 'text-warning-text',
  debug: 'text-muted-foreground',
  info: 'text-foreground',
}

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 }

type LevelFilter = 'all' | 'warn' | 'error'

function sourceLabel(source: string): string {
  return (SOURCE_LABELS as Record<string, string>)[source as SourceId] ?? source
}

function fmtTime(v: string): string {
  const d = toDate(v)
  return d ? format(d, 'HH:mm:ss') : '--:--:--'
}

function LogLine({ log }: { log: RunLog }) {
  const hasMeta = log.meta !== null && log.meta !== undefined && !(typeof log.meta === 'object' && Object.keys(log.meta as object).length === 0)
  const level = log.level.toLowerCase()
  return (
    <li className="flex flex-col gap-0.5 px-4 py-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="flex shrink-0 gap-2">
        <span className="text-muted-foreground tabular-nums">{fmtTime(log.createdAt)}</span>
        <span className={cn('w-12 font-medium uppercase', LEVEL_CLASS[level] ?? 'text-foreground')}>{level}</span>
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn('wrap-break-word whitespace-pre-wrap', level === 'error' || level === 'warn' ? LEVEL_CLASS[level] : 'text-foreground')}>{log.message}</span>
        {hasMeta ? (
          <Collapsible className="mt-1">
            <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3 transition-transform group-data-panel-open:rotate-180" /> meta
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 max-h-64 overflow-auto rounded-md border bg-background p-2 text-[11px] leading-snug text-foreground">{JSON.stringify(log.meta, null, 2)}</pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </li>
  )
}

function Count({ value, danger }: { value: number; danger?: boolean }) {
  return <span className={cn('tabular-nums', danger && value > 0 ? 'font-medium text-danger-text' : value === 0 && 'text-muted-foreground')}>{fmtNumber(value)}</span>
}

/** Phone: one card per source. */
function SourceCards({ sources }: { sources: RunSource[] }) {
  return (
    <ul className="divide-y md:hidden">
      {sources.map((s) => (
        <li key={s.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 font-medium">
              {sourceLabel(s.source)}
              {s.country ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {flagEmoji(s.country)} {countryName(s.country)}
                </span>
              ) : null}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fmtDuration(s.durationMs)}</span>
          </div>
          {s.query ? <p className="truncate text-xs text-muted-foreground">Query: {s.query}</p> : null}
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span>
              <span className="text-muted-foreground">requests</span> <Count value={s.requests} />
            </span>
            <span>
              <span className="text-muted-foreground">returned</span> <Count value={s.returned} />
            </span>
            <span>
              <span className="text-muted-foreground">new</span> <Count value={s.created} />
            </span>
            <span>
              <span className="text-muted-foreground">seen</span> <Count value={s.duplicates} />
            </span>
            <span>
              <span className="text-muted-foreground">errors</span> <Count value={s.errors} danger />
            </span>
          </p>
          {s.error ? <p className="wrap-break-word text-xs text-danger-text">{s.error}</p> : null}
        </li>
      ))}
    </ul>
  )
}

/** md and up: one table, scrolling sideways inside its section when narrow. */
function SourceTable({ sources }: { sources: RunSource[] }) {
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Source</TableHead>
            <TableHead>Query</TableHead>
            <TableHead>Country</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Returned</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead className="text-right">Seen</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="pr-4 text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="pl-4 font-medium">
                {sourceLabel(s.source)}
                {s.error ? (
                  <span className="mt-0.5 block max-w-xs truncate text-xs font-normal text-danger-text" title={s.error}>
                    {s.error}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground" title={s.query ?? undefined}>
                {s.query ?? '-'}
              </TableCell>
              <TableCell className="whitespace-nowrap">{s.country ? `${flagEmoji(s.country)} ${s.country}` : '-'}</TableCell>
              <TableCell className="text-right">
                <Count value={s.requests} />
              </TableCell>
              <TableCell className="text-right">
                <Count value={s.returned} />
              </TableCell>
              <TableCell className="text-right">
                <Count value={s.created} />
              </TableCell>
              <TableCell className="text-right">
                <Count value={s.duplicates} />
              </TableCell>
              <TableCell className="text-right">
                <Count value={s.errors} danger />
              </TableCell>
              <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">{fmtDuration(s.durationMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function RunDetail({ id }: { id: string }) {
  const query = useApiQuery<RunDetailPayload>(['runs', id], `/api/runs/${id}?logLimit=${LOG_LIMIT}`, {
    refetchInterval: (q) => (q.state.data?.data.status === 'RUNNING' ? 5_000 : false),
  })
  const [level, setLevel] = useState<LevelFilter>('all')
  const run = query.data?.data

  const logs = useMemo(() => {
    if (!run) return []
    if (level === 'all') return run.logs
    const min = LEVEL_RANK[level] ?? 0
    return run.logs.filter((l) => (LEVEL_RANK[l.level.toLowerCase()] ?? 1) >= min)
  }, [run, level])

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <div className="h-14" />
        <MetricsSkeleton count={10} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />
        <SectionSkeleton rows={6} />
      </div>
    )
  }
  if (query.isError || !run) {
    return (
      <EmptyState
        title={query.error?.status === 404 ? 'Run not found' : 'Could not load this run'}
        description={query.error?.message}
        action={
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/runs" />}>
            <ArrowLeft className="size-3.5" /> Back to runs
          </Button>
        }
      />
    )
  }

  const running = run.status === 'RUNNING'
  const errors = parseErrorDetails(run.errorDetails)
  const errorCount = run.logs.filter((l) => l.level.toLowerCase() === 'error').length
  const warnCount = run.logs.filter((l) => l.level.toLowerCase() === 'warn').length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Run <span className="font-mono text-base font-medium text-muted-foreground">{run.id.slice(-8)}</span>
          </span>
        }
        description={
          running
            ? run.cancelRequested
              ? 'Stop requested: the worker finishes the batch it is on, then ends the run.'
              : `Running for ${fmtAgo(run.startedAt).replace(' ago', '')}; this page refreshes every 5 seconds.`
            : run.status === 'FAILED' || run.status === 'CANCELLED'
              ? `This run ended early (${run.status === 'FAILED' ? 'failed' : 'stopped'}), so the totals stay at zero; the sources below show what it fetched before that.`
              : `${titleCase(run.trigger)} run, ${fmtNumber(run.totalNew)} new job${run.totalNew === 1 ? '' : 's'} found.`
        }
        meta={
          <>
            <RunStatusBadge status={run.status} />
            {running ? <Loader2 className="size-3.5 animate-spin" aria-label="Running" /> : null}
            <span>{titleCase(run.trigger)}</span>
            <span>Started {fmtDateTime(run.startedAt)}</span>
            {run.finishedAt ? <span>Finished {fmtDateTime(run.finishedAt)}</span> : null}
            {run.durationMs != null ? <span className="tabular-nums">{fmtDuration(run.durationMs)}</span> : null}
          </>
        }
        actions={running ? <StopRunButton runId={run.id} cancelRequested={run.cancelRequested} /> : null}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Fetched" value={fmtNumber(run.totalFetched)} />
        <Metric label="New" value={fmtNumber(run.totalNew)} tone={run.totalNew > 0 ? 'primary' : 'default'} />
        <Metric label="Already seen" value={fmtNumber(run.totalDuplicates)} />
        <Metric label="Filtered" value={fmtNumber(run.totalFiltered)} />
        <Metric label="Enriched" value={fmtNumber(run.totalEnriched)} />
        <Metric label="Ranked" value={fmtNumber(run.totalRanked)} />
        <Metric label="Drafted" value={fmtNumber(run.totalDrafted)} />
        <Metric label="Queued" value={fmtNumber(run.totalQueued)} />
        <Metric label="Errors" value={fmtNumber(run.errorCount)} tone={run.errorCount > 0 ? 'danger' : 'default'} />
        <Metric label="Duration" value={fmtDuration(run.durationMs)} />
      </div>

      {errors.length > 0 ? (
        <Section title="Errors" count={errors.length} contentClassName="p-0">
          <ul className="divide-y text-sm">
            {errors.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-3">
                {e.step ? <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">{e.step}</span> : null}
                <span className="wrap-break-word text-danger-text">{e.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Sources" count={run.sources.length} description="Each source and query this run asked, with what came back." contentClassName="p-0">
        {run.sources.length === 0 ? (
          <EmptyState compact className="m-4" title={running ? 'No source has reported yet' : 'No sources ran'} />
        ) : (
          <>
            <SourceTable sources={run.sources} />
            <SourceCards sources={run.sources} />
          </>
        )}
      </Section>

      <Section
        title="Log"
        count={run.logs.length}
        description={
          errorCount || warnCount ? (
            <span className="flex flex-wrap gap-2">
              {errorCount > 0 ? <ToneBadge tone="danger">{errorCount} errors</ToneBadge> : null}
              {warnCount > 0 ? <ToneBadge tone="warning">{warnCount} warnings</ToneBadge> : null}
            </span>
          ) : undefined
        }
        actions={
          <Segmented<LevelFilter>
            size="sm"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'all', label: 'All' },
              { value: 'warn', label: 'Warnings', count: warnCount + errorCount },
              { value: 'error', label: 'Errors', count: errorCount },
            ]}
          />
        }
        contentClassName="p-0"
      >
        {logs.length === 0 ? (
          <EmptyState compact className="m-4" title={run.logs.length === 0 ? 'No log lines yet' : 'No log lines at this level'} />
        ) : (
          <ol className="divide-y bg-muted font-mono text-xs">
            {logs.map((l) => (
              <LogLine key={l.id} log={l} />
            ))}
          </ol>
        )}
        {run.logs.length >= LOG_LIMIT ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing the first {LOG_LIMIT} lines.</p> : null}
      </Section>
    </div>
  )
}
