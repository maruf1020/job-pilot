'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useApiQuery } from '@/lib/api/hooks'
import { fmtNumber } from '@/lib/format'
import { StatusDot } from '@/components/shared/status-badge'

interface PortalBatchLite {
  batch: { id: string; status: string; mode: string; target: number; continuous: boolean; submitted: number; needsHuman: number; waitingFor: string | null }
}
interface EmailBatchLite {
  id: string
  status: string
  target: number
  continuous: boolean
  sent: number
  queued: number
  held: number
  activity: string | null
}

function Row({ label, running, text, detail }: { label: string; running: boolean; text: string; detail?: string | null }) {
  return (
    <Link href="/applications" className="flex min-w-0 items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50">
      <StatusDot tone={running ? 'success' : 'muted'} label={running ? 'running' : 'stopped'} />
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {text}
        {detail ? <span className="hidden md:inline"> · {detail}</span> : null}
      </span>
      <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** One line per auto-apply batch (browser and email): running or not, progress, what it waits for. Start and stop live on Applications. */
export function EngineStrip() {
  const portal = useApiQuery<PortalBatchLite | null>(['portal-batches'], '/api/portal-batches', { refetchInterval: 30_000 })
  const email = useApiQuery<EmailBatchLite | null>(['apply-batches'], '/api/apply-batches', { refetchInterval: 60_000 })
  const p = portal.data?.data?.batch
  const e = email.data?.data
  if (!p && !e) return null
  return (
    <div className="divide-y overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-card)]">
      {p ? (
        <Row
          label="Browser apply"
          running={p.status === 'RUNNING'}
          text={p.status === 'RUNNING' ? `${fmtNumber(p.submitted)} submitted${p.continuous ? '' : ` of ${fmtNumber(p.target)}`} · ${fmtNumber(p.needsHuman)} need you` : `last batch ${p.status.toLowerCase()} · ${fmtNumber(p.submitted)} submitted`}
          detail={p.status === 'RUNNING' ? p.waitingFor : null}
        />
      ) : null}
      {e ? (
        <Row
          label="Email apply"
          running={e.status === 'RUNNING'}
          text={e.status === 'RUNNING' ? `${fmtNumber(e.sent)} sent · ${fmtNumber(e.queued)} queued · ${fmtNumber(e.held)} held` : `last batch ${e.status.toLowerCase()} · ${fmtNumber(e.sent)} sent`}
          detail={e.status === 'RUNNING' ? e.activity : null}
        />
      ) : null}
    </div>
  )
}
