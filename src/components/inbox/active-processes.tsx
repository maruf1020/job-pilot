'use client'

import Link from 'next/link'
import { useApiQuery } from '@/lib/api/hooks'
import type { ActiveProcess } from '@/lib/applications/hiring'
import { flagEmoji, fmtAgo } from '@/lib/format'
import { ListRows, Section } from '@/components/shared/section'

/** Companies where you are mid-process (assessment done, interview booked...), with the step you are on. */
export function ActiveProcessesPanel() {
  const q = useApiQuery<ActiveProcess[]>(['inbox', 'processes'], '/api/inbox/processes', { refetchInterval: 60_000 })
  const items = q.data?.data ?? []
  if (items.length === 0) return null
  return (
    <Section title="In process" count={items.length} description="Where you are in each company's hiring steps." href="/applications?view=ongoing" hrefLabel="Ongoing" contentClassName="p-0">
      <ListRows>
        {items.map((p) => (
          <li key={p.applicationId}>
            <Link href={`/applications/${p.applicationId}`} className="flex flex-col gap-1 px-4 py-3 text-sm transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 flex-1 truncate font-medium" title={`${p.company} · ${p.title}`}>
                {flagEmoji(p.countryCode)} {p.company} <span className="font-normal text-muted-foreground">· {p.title}</span>
              </span>
              <span className="text-xs">
                Now: <span className="font-medium">{p.current?.name ?? '-'}</span>
                {p.next ? <span className="text-muted-foreground"> then {p.next.name}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {p.done}/{p.total} done · {fmtAgo(p.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ListRows>
    </Section>
  )
}
