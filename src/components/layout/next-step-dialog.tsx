'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, BellRing, CalendarCheck, Clock, type LucideIcon, MapPin, MessageCircleQuestion, PartyPopper } from 'lucide-react'
import { fmtAgo } from '@/lib/format'
import { nextStepLabel, popupItems, snoozeNextSteps, type NextStepSnooze } from '@/lib/next-step'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** A next-step notification as GET /api/notifications returns it in `nextSteps`. */
export interface NextStepItem {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  classification: string | null
  readAt: string | null
  ackedAt: string | null
  createdAt: string
  company: string | null
  jobTitle: string | null
  location: string | null
}

const ICON: Record<string, LucideIcon> = { INTERVIEW_REQUEST: CalendarCheck, POSITIVE: PartyPopper, NEEDS_INFO: MessageCircleQuestion }

export function nextStepIcon(classification: string | null): LucideIcon {
  return ICON[classification ?? ''] ?? CalendarCheck
}

const SNOOZE_KEY = 'next-step-snooze'

function loadSnooze(): NextStepSnooze | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY)
    return raw ? (JSON.parse(raw) as NextStepSnooze) : null
  } catch {
    return null
  }
}

function saveSnooze(snooze: NextStepSnooze) {
  try {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(snooze))
  } catch {
    // Private mode: "Later" then lasts until the page reloads.
  }
}

/**
 * Pops up on any page when an employer asks you for a next step. "Open" and "Got it" acknowledge
 * on the server, so the same email never pops up again (on any device); "Later" (or Escape) only
 * snoozes it in this browser for an hour, and it stays pinned in the bell meanwhile.
 * It rides on the bell's poll: `now` is when that data was fetched.
 */
export function NextStepDialog({ items, now, onAck }: { items: NextStepItem[]; now: number; onAck: (ids: string[]) => void }) {
  const router = useRouter()
  const [snooze, setSnooze] = useState<NextStepSnooze | null>(() => (typeof window === 'undefined' ? null : loadSnooze()))
  // Acknowledged here but maybe not yet refetched: never show them again in this session.
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set())
  // Keeps the list on screen while the dialog fades out.
  const [leaving, setLeaving] = useState<NextStepItem[]>([])

  const visible = popupItems(items.filter((n) => !acked.has(n.id)), snooze, now)
  const shown = visible.length > 0 ? visible : leaving

  const snoozeIds = (ids: string[]) => {
    const next = snoozeNextSteps(ids)
    setSnooze(next)
    saveSnooze(next)
  }
  const later = () => {
    setLeaving(visible)
    snoozeIds(visible.map((n) => n.id))
  }
  const gotIt = () => {
    const ids = visible.map((n) => n.id)
    setLeaving(visible)
    setAcked((prev) => new Set([...prev, ...ids]))
    onAck(ids)
  }
  const open = (n: NextStepItem) => {
    setLeaving(visible)
    setAcked((prev) => new Set([...prev, n.id]))
    // The rest wait in the bell while you read this one.
    snoozeIds(visible.filter((v) => v.id !== n.id).map((v) => v.id))
    onAck([n.id])
    if (n.link) router.push(n.link)
  }

  const first = shown[0]
  const title = shown.length === 1 ? `${first?.company ?? 'An employer'} is waiting for you` : `${shown.length} employers are waiting for you`

  return (
    <Dialog
      open={visible.length > 0}
      onOpenChange={(next) => {
        if (!next) later()
      }}
      // A stray click next to it must not dismiss an interview; Escape and the close button mean "Later".
      disablePointerDismissal
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <div className="border-b border-success/20 bg-success-soft px-5 pb-4 pt-5">
          <div className="flex items-start gap-3 pr-6">
            <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-white shadow-sm" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-success/30 motion-reduce:hidden" />
              <BellRing className="relative size-5" />
            </span>
            <DialogHeader className="gap-1">
              <DialogTitle className="text-lg font-semibold leading-tight">{title}</DialogTitle>
              <DialogDescription>{shown.length === 1 ? 'Their email asks you for a next step.' : 'These emails ask you for a next step.'} A quick answer keeps the momentum.</DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <ul className="max-h-[min(55vh,440px)] divide-y overflow-y-auto overscroll-contain">
          {shown.map((n) => {
            const Icon = nextStepIcon(n.classification)
            return (
              <li key={n.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-text" aria-hidden>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-semibold uppercase tracking-wide text-success-text">{nextStepLabel(n.classification)}</span>
                      <span className="text-muted-foreground" aria-hidden>
                        ·
                      </span>
                      <span className="shrink-0 text-muted-foreground">{fmtAgo(n.createdAt)}</span>
                    </p>
                    {n.company ? (
                      <>
                        <p className="mt-0.5 truncate text-sm font-semibold">{n.company}</p>
                        <p className="flex min-w-0 items-center gap-1.5 text-sm text-foreground/90">
                          <span className="truncate">{n.jobTitle}</span>
                          {n.location ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                              <MapPin className="size-3" aria-hidden />
                              <span className="max-w-32 truncate">{n.location}</span>
                            </span>
                          ) : null}
                        </p>
                      </>
                    ) : (
                      <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{n.title}</p>
                    )}
                    {n.body ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{n.body}</p> : null}
                  </div>
                </div>
                {n.link ? (
                  <Button size="sm" onClick={() => open(n)} className="shrink-0 self-end sm:self-center" aria-label={`Open ${n.company ?? n.title}`}>
                    Open <ArrowUpRight />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>

        <DialogFooter className="mx-0 mb-0 sm:items-center sm:justify-between">
          <p className="hidden text-xs text-muted-foreground sm:block">Later keeps {shown.length === 1 ? 'it' : 'them'} pinned in the bell.</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={later}>
              <Clock /> Later
            </Button>
            <Button onClick={gotIt}>Got it</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
