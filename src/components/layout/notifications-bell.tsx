'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData } from '@tanstack/react-query'
import { isToday, isYesterday } from 'date-fns'
import { Bell, BellOff, CalendarCheck, Check, CheckCheck, Gauge, Hand, Loader2, type LucideIcon, MapPin, MessageSquare, Newspaper, Pin, Search, Send, Settings, TriangleAlert, X } from 'lucide-react'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtAgo } from '@/lib/format'
import { nextStepLabel } from '@/lib/next-step'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { NextStepDialog, nextStepIcon, type NextStepItem } from './next-step-dialog'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  classification: string | null
  nextStep: boolean
  ackedAt: string | null
  createdAt: string
}

interface NotificationsData {
  items: NotificationItem[]
  unread: number
  unreadByType: Record<string, number>
  attention: number
  /** Employer replies waiting for you, whatever the filter: pinned on top and shown as a popup. */
  nextSteps: NextStepItem[]
}

type Filter = 'all' | 'unread' | 'needs'

const PAGE = 30

const TYPE_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  review_needed: { label: 'Needs you', icon: Hand, tone: 'bg-warning-soft text-warning-text' },
  reply: { label: 'Reply', icon: MessageSquare, tone: 'bg-info-soft text-info-text' },
  interview: { label: 'Interview', icon: CalendarCheck, tone: 'bg-success-soft text-success-text' },
  sent: { label: 'Applied', icon: Send, tone: 'bg-success-soft text-success-text' },
  run_complete: { label: 'Finished', icon: Search, tone: 'bg-muted text-muted-foreground' },
  quota: { label: 'Quota', icon: Gauge, tone: 'bg-warning-soft text-warning-text' },
  error: { label: 'Problem', icon: TriangleAlert, tone: 'bg-danger-soft text-danger-text' },
  digest: { label: 'Digest', icon: Newspaper, tone: 'bg-primary-soft text-primary-text' },
}
const FALLBACK = { label: 'Update', icon: Bell, tone: 'bg-muted text-muted-foreground' }
const NEXT_STEP_TONE = 'bg-success-soft text-success-text'

/** "Browser apply needs you: Senior Engineer at Acme" → kicker "Browser apply needs you", title "Senior Engineer at Acme". */
function splitTitle(n: NotificationItem): { kicker: string; title: string } {
  const m = /^([^:]{3,40}):\s+(.+)$/.exec(n.title)
  return m ? { kicker: m[1], title: m[2] } : { kicker: (TYPE_META[n.type] ?? FALLBACK).label, title: n.title }
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return 'Earlier'
}

export function NotificationsBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const query = filter === 'unread' ? '&unread=true' : filter === 'needs' ? '&type=review_needed' : ''
  // This poll also feeds the next-step popup; keepPreviousData so switching filters never blanks it.
  const { data, dataUpdatedAt, isLoading, isFetching, refetch } = useApiQuery<NotificationsData>(['notifications', filter, limit], `/api/notifications?limit=${limit}${query}`, {
    refetchInterval: open ? 15_000 : 30_000,
    placeholderData: keepPreviousData,
  })
  const markAll = useApiMutation(() => api.post('/api/notifications', { all: true }), { invalidate: [['notifications'], ['status']], silent: true })
  // Marking ids read also acknowledges their next steps (server side).
  const markRead = useApiMutation((ids: string[]) => api.post('/api/notifications', { ids }), { invalidate: [['notifications'], ['status']], silent: true })

  const unread = data?.data.unread ?? 0
  // Badge = what asks for you (needs you, replies, interviews, problems); news like "Sent" only adds a dot.
  const attention = data?.data.attention ?? 0
  const needsYou = data?.data.unreadByType?.review_needed ?? 0
  const nextSteps = useMemo(() => data?.data.nextSteps ?? [], [data])
  const items = useMemo(() => {
    const pinned = new Set(nextSteps.map((n) => n.id))
    return (data?.data.items ?? []).filter((n) => !pinned.has(n.id))
  }, [data, nextSteps])
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: NotificationItem[] }> = []
    for (const n of items) {
      const label = dayLabel(n.createdAt)
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(n)
      else out.push({ label, items: [n] })
    }
    return out
  }, [items])

  const openItem = (n: Pick<NotificationItem, 'id' | 'link' | 'readAt' | 'ackedAt'> & { nextStep?: boolean }) => {
    if (!n.readAt || (n.nextStep && !n.ackedAt)) markRead.mutate([n.id])
    if (n.link) {
      setOpen(false)
      router.push(n.link)
    }
  }

  const filters: Array<{ id: Filter; label: string; count?: number }> = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread', count: unread },
    { id: 'needs', label: 'Needs you', count: needsYou },
  ]

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) void refetch()
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={attention ? `Notifications, ${attention} need your attention` : 'Notifications'} className="relative">
              <Bell className="size-4" />
              {attention > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
                  {attention > 99 ? '99+' : attention}
                </span>
              ) : unread > 0 ? (
                <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />
              ) : null}
            </Button>
          }
        />
        <PopoverContent align="end" sideOffset={8} className="w-[min(94vw,400px)] gap-0 overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{unread > 99 ? '99+' : unread} new</span> : null}
            {isFetching && !isLoading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : null}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={() => markAll.mutate(undefined)} disabled={unread === 0 || markAll.isPending} className="text-muted-foreground">
                <CheckCheck className="size-3.5" /> Mark all read
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Notification settings" nativeButton={false} render={<Link href="/settings" onClick={() => setOpen(false)} />}>
                <Settings className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-1 border-b bg-muted/30 px-3 py-2" role="tablist" aria-label="Show">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => {
                  setFilter(f.id)
                  setLimit(PAGE)
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  filter === f.id && 'bg-background text-foreground shadow-sm ring-1 ring-foreground/10',
                )}
              >
                {f.label}
                {f.count ? (
                  <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', f.id === 'needs' ? 'bg-warning-soft text-warning-text' : 'bg-muted text-muted-foreground')}>
                    {f.count > 99 ? '99+' : f.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* List: its own scroll area with a real height limit, so long lists never spill out of the panel */}
          <div className="max-h-[min(62vh,520px)] overflow-y-auto overscroll-contain">
            {/* Pinned: an employer wants something from you. Stays here, in every filter, until you open or dismiss it. */}
            {nextSteps.length > 0 ? (
              <section aria-label="Needs your reply" className="border-b-2 border-success/40 bg-success-soft/60">
                <p className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-success/25 bg-card/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-success-text backdrop-blur">
                  <Pin className="size-3" aria-hidden /> Needs your reply · next step
                  <span className="ml-auto rounded-full bg-success px-1.5 text-[10px] tabular-nums text-white">{nextSteps.length}</span>
                </p>
                <ul className="divide-y divide-success/15">
                  {nextSteps.map((n) => {
                    const Icon = nextStepIcon(n.classification)
                    return (
                      <li key={n.id} className="relative">
                        <button
                          type="button"
                          onClick={() => openItem({ ...n, nextStep: true })}
                          className="flex w-full gap-3 border-l-[3px] border-success py-3 pl-[13px] pr-11 text-left transition-colors hover:bg-success-soft focus-visible:bg-success-soft focus-visible:outline-none"
                        >
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-white shadow-sm" aria-hidden>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[11px]">
                              <span className="truncate font-semibold text-success-text">{nextStepLabel(n.classification)}</span>
                              <span className="text-muted-foreground" aria-hidden>
                                ·
                              </span>
                              <span className="shrink-0 text-muted-foreground">{fmtAgo(n.createdAt)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">{n.company ?? n.title}</span>
                            {n.jobTitle ? (
                              <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground/80">
                                <span className="truncate">{n.jobTitle}</span>
                                {n.location ? (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground">
                                    <MapPin className="size-3" aria-hidden />
                                    <span className="max-w-28 truncate">{n.location}</span>
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            {n.body ? <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{n.body}</span> : null}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Dismiss ${n.company ?? 'this next step'}`}
                          onClick={() => markRead.mutate([n.id])}
                          className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}

            {isLoading ? (
              <ul className="divide-y" aria-busy>
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3">
                    <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
                    <div className="flex-1 space-y-2 py-0.5">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : items.length === 0 && nextSteps.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <BellOff className="size-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">{filter === 'all' ? 'No notifications yet' : 'You are all caught up'}</p>
                <p className="text-xs text-muted-foreground">
                  {filter === 'needs' ? 'Nothing is waiting for you.' : filter === 'unread' ? 'Every notification has been read.' : 'Applications, replies and runs show up here.'}
                </p>
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.label} aria-label={g.label}>
                  <p className="sticky top-0 z-10 border-b bg-popover/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{g.label}</p>
                  <ul className="divide-y">
                    {g.items.map((n) => {
                      // A next step you already handled keeps its colour, so it still stands out in the history.
                      const meta = n.nextStep ? { icon: nextStepIcon(n.classification), tone: NEXT_STEP_TONE } : (TYPE_META[n.type] ?? FALLBACK)
                      const Icon = meta.icon
                      const { kicker, title } = splitTitle(n)
                      return (
                        <li key={n.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => openItem(n)}
                            className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none', !n.readAt && 'bg-primary/[0.04]')}
                          >
                            <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', meta.tone)} aria-hidden>
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className="truncate font-medium">{kicker}</span>
                                <span aria-hidden>·</span>
                                <span className="shrink-0">{fmtAgo(n.createdAt)}</span>
                              </span>
                              <span className={cn('mt-0.5 line-clamp-2 text-sm leading-snug', !n.readAt ? 'font-semibold text-foreground' : 'text-foreground/90')}>{title}</span>
                              {n.body ? <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{n.body}</span> : null}
                            </span>
                            {!n.readAt ? (
                              <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                                <span className="sr-only">Unread</span>
                              </span>
                            ) : null}
                          </button>
                          {!n.readAt ? (
                            <Button
                              variant="outline"
                              size="icon-xs"
                              aria-label="Mark as read"
                              onClick={() => markRead.mutate([n.id])}
                              className="absolute right-3 bottom-2.5 bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                            >
                              <Check className="size-3" />
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>

          {/* Footer */}
          {items.length > 0 ? (
            <div className="flex items-center justify-between border-t px-4 py-2">
              <span className="text-[11px] text-muted-foreground">
                Showing {items.length}
                {filter === 'all' ? ' latest' : ''}
              </span>
              {(data?.data.items.length ?? 0) >= limit ? (
                <Button variant="ghost" size="xs" onClick={() => setLimit((l) => l + PAGE)} disabled={isFetching}>
                  Show older
                </Button>
              ) : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {/* Mounted with the bell (app shell header, every page) so it shares this poll instead of running its own. */}
      <NextStepDialog items={nextSteps} now={dataUpdatedAt} onAck={(ids) => markRead.mutate(ids)} />
    </>
  )
}
