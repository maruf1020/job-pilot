'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { closestCorners, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useIsFetching, useQueries, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, GripVertical, MessageSquare, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, useApiMutation, type ApiEnvelope } from '@/lib/api/hooks'
import type { ApplicationStatus } from '@/lib/domain'
import { flagEmoji, fmtAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AppStatusBadge, ScoreBadge } from '@/components/shared/status-badge'
import { BoardToolbar, filtersToApiParams, useBoardFilters } from './board-filters'
import { whenLabel } from './helpers'
import type { ApplicationListRow } from './types'

type ColumnKey = 'drafting' | 'review' | 'queued' | 'sent' | 'replied' | 'interview' | 'closed'

interface BoardColumnDef {
  key: ColumnKey
  title: string
  hint: string
  statuses: ApplicationStatus[]
  /** Accent used for the header dot and the drop highlight. */
  accent: string
}

const BOARD_COLUMNS: BoardColumnDef[] = [
  { key: 'drafting', title: 'Drafting', hint: 'The worker is writing these', statuses: ['DRAFT'], accent: 'bg-info' },
  { key: 'review', title: 'Review', hint: 'Read, edit, approve', statuses: ['REVIEW', 'NEEDS_HUMAN'], accent: 'bg-warning' },
  { key: 'queued', title: 'Queued', hint: 'Waiting for the send window', statuses: ['APPROVED', 'QUEUED'], accent: 'bg-primary' },
  { key: 'sent', title: 'Sent', hint: 'Waiting for an answer', statuses: ['SENT'], accent: 'bg-success' },
  { key: 'replied', title: 'Replied', hint: 'They wrote back', statuses: ['REPLIED'], accent: 'bg-chart-1' },
  { key: 'interview', title: 'Interview', hint: 'Calls, interviews, offers', statuses: ['INTERVIEW', 'OFFER'], accent: 'bg-success' },
  { key: 'closed', title: 'Closed', hint: 'Rejected, skipped, no answer', statuses: ['REJECTED', 'NO_RESPONSE', 'SKIPPED'], accent: 'bg-muted-foreground' },
]

const BOARD_KEY = ['applications', 'board']
const SENT_LIKE: ApplicationStatus[] = ['SENT', 'REPLIED', 'INTERVIEW', 'OFFER']
const PAGE_SIZE = 100

function columnOf(status: string): ColumnKey {
  return BOARD_COLUMNS.find((c) => c.statuses.includes(status as ApplicationStatus))?.key ?? 'closed'
}

type Transition = { kind: 'action'; action: 'approve' | 'unqueue' | 'skip' } | { kind: 'status'; status: ApplicationStatus } | { kind: 'blocked'; reason: string }

/** What dropping a card into a column means. Sending is never a drag: it stays an explicit action on the application page. */
function transitionFor(row: ApplicationListRow, to: ColumnKey): Transition {
  const status = row.status as ApplicationStatus
  const from = columnOf(status)
  if (from === to) return { kind: 'blocked', reason: 'Already in that column' }
  const sentLike = SENT_LIKE.includes(status)
  switch (to) {
    case 'queued':
      if (sentLike) return { kind: 'blocked', reason: 'This one already went out' }
      if (row.channel !== 'email') return { kind: 'blocked', reason: 'Only email applications can be queued; apply through the portal from the application page' }
      if (status === 'DRAFT') return { kind: 'blocked', reason: 'Still being drafted; wait for the draft to finish' }
      return { kind: 'action', action: 'approve' }
    case 'review':
      if (status === 'QUEUED' || status === 'APPROVED') return { kind: 'action', action: 'unqueue' }
      if (status === 'DRAFT') return { kind: 'blocked', reason: 'Still being drafted' }
      if (sentLike) return { kind: 'blocked', reason: 'Already sent; it cannot go back to review' }
      return { kind: 'status', status: 'REVIEW' }
    case 'closed':
      return sentLike ? { kind: 'status', status: 'REJECTED' } : { kind: 'action', action: 'skip' }
    case 'replied':
      if (status === 'SENT' || status === 'INTERVIEW' || status === 'OFFER') return { kind: 'status', status: 'REPLIED' }
      return { kind: 'blocked', reason: 'Only sent applications can be marked as replied' }
    case 'interview':
      if (status === 'SENT' || status === 'REPLIED') return { kind: 'status', status: 'INTERVIEW' }
      return { kind: 'blocked', reason: 'Only sent or replied applications can move to interview' }
    case 'sent':
      return { kind: 'blocked', reason: 'Sending is done from the application page (Approve or Send now)' }
    case 'drafting':
      return { kind: 'blocked', reason: 'Use "Regenerate" on the application page to redraft' }
  }
}

function initials(name: string): string {
  const parts = name.replace(/[^a-z0-9 ]/gi, ' ').trim().split(/\s+/)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

function CardBody({ row, dragging = false }: { row: ApplicationListRow; dragging?: boolean }) {
  const passed = row.drafts.some((d) => d.passed)
  return (
    <div className={cn('rounded-lg border bg-card p-3 text-sm shadow-xs transition-shadow hover:shadow-md', dragging && 'shadow-lg ring-2 ring-primary/40')}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">{initials(row.job.companyName)}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/applications/${row.id}`} className="line-clamp-2 font-medium leading-snug hover:underline">
            {row.job.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="mr-1">{flagEmoji(row.job.countryCode)}</span>
            {row.job.companyName}
          </p>
        </div>
        <GripVertical className="size-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <ScoreBadge score={row.job.score?.finalScore} />
        <AppStatusBadge status={row.status} />
        {passed ? <CheckCircle2 className="size-3.5 text-success-text" aria-label="Has a passing draft" /> : null}
        {row._count.messages > 0 ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" /> {row._count.messages}
          </span>
        ) : null}
      </div>
      <p className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{whenLabel(row)}</span>
        <span className="shrink-0">{fmtAgo(row.lastActivityAt)}</span>
      </p>
    </div>
  )
}

function DraggableCard({ row, moving }: { row: ApplicationListRow; moving: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, data: { row } })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={cn('cursor-grab touch-manipulation active:cursor-grabbing', isDragging && 'opacity-30', moving && 'animate-pulse opacity-60')}
      aria-label={`${row.job.title} at ${row.job.companyName}. Drag to another column to change its status.`}
    >
      <CardBody row={row} />
    </div>
  )
}

function BoardColumn({ col, rows, total, pending, error, movingId }: { col: BoardColumnDef; rows: ApplicationListRow[]; total: number | undefined; pending: boolean; error: string | null; movingId: string | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key })
  return (
    <section ref={setNodeRef} className={cn('flex h-full w-80 shrink-0 snap-start flex-col rounded-lg bg-muted ring-1 ring-border transition-shadow', isOver && 'bg-primary-soft ring-2 ring-primary/60')} aria-label={col.title}>
      <header className="sticky top-0 z-10 rounded-t-lg bg-muted px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 truncate text-sm font-semibold">
            <span className={cn('size-2.5 rounded-full', col.accent)} aria-hidden="true" />
            {col.title}
          </h2>
          <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground ring-1 ring-foreground/10">{total ?? '…'}</span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{col.hint}</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-3">
        {pending ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
        ) : error ? (
          <p className="px-1 py-4 text-center text-xs text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className={cn('rounded-lg border border-dashed px-2 py-8 text-center text-xs text-muted-foreground', isOver && 'border-primary/60 text-foreground')}>{isOver ? 'Drop here' : 'Nothing here'}</p>
        ) : (
          rows.map((row) => <DraggableCard key={row.id} row={row} moving={movingId === row.id} />)
        )}
        {total != null && total > rows.length ? (
          <p className="px-1 pt-1 text-center text-[11px] text-muted-foreground">
            Showing {rows.length} of {total}. Narrow the board with a filter to see the rest.
          </p>
        ) : null}
      </div>
    </section>
  )
}

export function ApplicationsBoard() {
  const qc = useQueryClient()
  const fetching = useIsFetching({ queryKey: BOARD_KEY }) > 0
  const [filters, setFilters] = useBoardFilters()
  const [active, setActive] = useState<ApplicationListRow | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)

  // Each column asks the list API for its statuses (narrowed by the board filters); one query per column.
  const columnQueries = useMemo(() => {
    const base = filtersToApiParams(filters)
    return BOARD_COLUMNS.map((col) => {
      const statuses = filters.statuses.length ? col.statuses.filter((s) => filters.statuses.includes(s)) : col.statuses
      if (statuses.length === 0) return { col, url: null as string | null }
      const sp = new URLSearchParams(base)
      sp.set('pageSize', String(PAGE_SIZE))
      sp.set('filter[status][in]', statuses.join(','))
      return { col, url: `/api/applications?${sp.toString()}` }
    })
  }, [filters])

  const queries = useQueries({
    queries: columnQueries.map(({ col, url }) => ({
      queryKey: [...BOARD_KEY, col.key, url],
      queryFn: () => (url ? api.get<ApplicationListRow[]>(url) : Promise.resolve({ data: [] as ApplicationListRow[], meta: { total: 0 } } as unknown as ApiEnvelope<ApplicationListRow[]>)),
      refetchInterval: 60_000,
    })),
  })

  const move = useApiMutation<{ row: ApplicationListRow; t: Transition }, unknown>(
    ({ row, t }) => {
      if (t.kind === 'action') return api.post(`/api/applications/${row.id}/actions`, { action: t.action })
      if (t.kind === 'status') return api.patch(`/api/applications/${row.id}`, { status: t.status })
      return Promise.reject(new Error(t.reason))
    },
    {
      invalidate: [['applications'], ['status']],
      successMessage: (_d, env: ApiEnvelope<unknown>) => env.message,
      onSuccess: () => setMovingId(null),
    },
  )

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { row: ApplicationListRow } | undefined)?.row ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const row = (e.active.data.current as { row: ApplicationListRow } | undefined)?.row
    const to = e.over?.id as ColumnKey | undefined
    if (!row || !to) return
    const t = transitionFor(row, to)
    if (t.kind === 'blocked') {
      if (t.reason !== 'Already in that column') toast.info(t.reason)
      return
    }
    setMovingId(row.id)
    move.mutate({ row, t }, { onError: () => setMovingId(null) })
  }

  const visible = columnQueries
    .map(({ col, url }, i) => ({ col, url, q: queries[i] }))
    .filter(({ url, q }) => url !== null && !(filters.hideEmpty && !q.isPending && (q.data?.meta?.total ?? 0) === 0))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BoardToolbar filters={filters} onChange={setFilters} className="flex-1" />
        <Button variant="ghost" size="sm" disabled={fetching} onClick={() => void qc.invalidateQueries({ queryKey: BOARD_KEY })}>
          <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} /> Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Drag a card to Review, Queued, Replied, Interview or Closed to change its status. Sending stays on the application page.</p>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        {/* Full-height, horizontally scrolling lane of fixed-width columns; each column scrolls on its own. */}
        <div className="flex h-[calc(100dvh-19rem)] min-h-104 snap-x gap-4 overflow-x-auto pb-3 md:h-[calc(100dvh-15.5rem)]">
          {visible.length === 0 ? (
            <p className="w-full self-center text-center text-sm text-muted-foreground">No columns to show. Tick a status or clear the filters.</p>
          ) : (
            visible.map(({ col, q }) => <BoardColumn key={col.key} col={col} rows={q.data?.data ?? []} total={q.data?.meta?.total} pending={q.isPending} error={q.isError ? q.error.message : null} movingId={movingId} />)
          )}
        </div>
        <DragOverlay dropAnimation={null}>{active ? <div className="w-80 rotate-1 cursor-grabbing">{<CardBody row={active} dragging />}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
