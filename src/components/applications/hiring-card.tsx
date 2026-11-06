'use client'

import { Check, ChevronDown, Circle, CircleDot, Maximize2 } from 'lucide-react'
import type { HiringInfo } from '@/lib/applications/hiring'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Markdown } from '@/components/shared/markdown'

/** The company's hiring steps with the one you are on, and the write-ups saved along the way. */
export function HiringCard({ hiring }: { hiring?: HiringInfo }) {
  if (!hiring || (hiring.stages.length === 0 && hiring.preps.length === 0)) return null
  const current = hiring.stages.find((s) => s.status === 'current')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hiring process</CardTitle>
        <CardDescription>
          {current ? <>Next: <span className="font-medium text-foreground">{current.name}</span></> : 'Every step so far is done.'}
          {hiring.updatedAt ? ` · updated ${fmtDateTime(hiring.updatedAt)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hiring.stages.length ? (
          <ol className="flex flex-col gap-2">
            {hiring.stages.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex items-start gap-2.5 text-sm">
                {s.status === 'done' ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Done" />
                ) : s.status === 'current' ? (
                  <CircleDot className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Next" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" aria-label="Later" />
                )}
                <div className="min-w-0">
                  <p className={cn(s.status === 'todo' && 'text-muted-foreground', s.status === 'current' && 'font-medium')}>
                    {i + 1}. {s.name}
                    {s.at ? <span className="ml-2 text-xs font-normal text-muted-foreground">{/^\d{4}-\d{2}-\d{2}$/.test(s.at) ? fmtDate(`${s.at}T12:00:00`) : fmtDateTime(s.at)}</span> : null}
                  </p>
                  {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {hiring.preps.map((p) => (
          <Collapsible key={p.id}>
            <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-medium hover:bg-accent">
              <span className="min-w-0 truncate">
                {p.title}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtDateTime(p.createdAt)}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 flex flex-col gap-2">
              <div className="flex justify-end">
                <Dialog>
                  <DialogTrigger render={<Button size="sm" variant="outline" />}>
                    <Maximize2 /> Full screen
                  </DialogTrigger>
                  <DialogContent className="flex h-[92vh] flex-col sm:max-w-5xl">
                    <DialogHeader>
                      <DialogTitle>{p.title}</DialogTitle>
                      <DialogDescription>Saved {fmtDateTime(p.createdAt)}</DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto pr-2">
                      <Markdown className="mx-auto max-w-3xl text-[0.95rem]">{p.body}</Markdown>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="max-h-[32rem] overflow-y-auto rounded-lg bg-muted p-4">
                <Markdown>{p.body}</Markdown>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  )
}
