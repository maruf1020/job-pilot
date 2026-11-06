'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, Mail, Send, Unplug, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, useApiMutation, useApiQuery } from '@/lib/api/hooks'
import { fmtDateTime } from '@/lib/format'
import { ConfirmButton } from '@/components/shared/confirm-button'
import { CopyButton } from '@/components/shared/copy-button'
import { ToneBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from './fields'

export interface EmailStatus {
  provider: 'gmail' | 'smtp'
  ready: { ready: boolean; reason?: string }
  gmail: {
    configured: boolean
    redirectUri: string
    connection: { email: string | null; connectedAt: string; scopes: string[] } | null
  }
  smtp: { configured: boolean; host: string | null; from: string | null }
  sentOrQueuedToday: number
  dailySendCap: number
}

type EmailAction = 'test' | 'disconnect-gmail' | 'test-gmail'

/** Reads ?connected= / ?error= written by the Gmail OAuth callback, toasts once, then cleans the URL. */
export function OAuthResultToast() {
  const sp = useSearchParams()
  const router = useRouter()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    const connected = sp.get('connected')
    const error = sp.get('error')
    if (!connected && !error) return
    done.current = true
    if (connected) toast.success(`Gmail connected as ${connected}`)
    if (error) toast.error(`Gmail connection failed: ${error}`)
    router.replace('/settings/email')
  }, [sp, router])
  return null
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <p className="flex items-start gap-1.5 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 wrap-break-word">
        {label}
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </p>
  )
}

export function GmailCard() {
  const query = useApiQuery<EmailStatus>(['email'], '/api/email')
  const s = query.data?.data

  const act = useApiMutation<EmailAction, unknown>((action) => api.post('/api/email', { action }), {
    invalidate: [['email'], ['status']],
    successMessage: (data, env) => {
      if (env.message && env.message !== 'OK') return env.message
      if (data && typeof data === 'object' && 'disconnected' in data) return 'Gmail disconnected'
      if (data && typeof data === 'object' && 'email' in data) {
        const d = data as { email: string; messagesTotal: number }
        return `Gmail OK — ${d.email} (${d.messagesTotal.toLocaleString()} messages)`
      }
      return 'Done'
    },
  })
  const busy = act.isPending
  const pendingAction = act.isPending ? act.variables : null

  if (query.isPending) {
    return (
      <SectionCard title="Email provider">
        <Skeleton className="h-24 w-full" />
      </SectionCard>
    )
  }
  if (query.isError || !s) {
    return (
      <SectionCard title="Email provider">
        <p className="text-sm text-danger-text">{query.error?.message ?? 'Could not load provider status'}</p>
        <Button size="sm" variant="outline" className="self-start" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </SectionCard>
    )
  }

  const capPct = s.dailySendCap > 0 ? Math.min(100, Math.round((s.sentOrQueuedToday / s.dailySendCap) * 100)) : 0
  const gmailConnected = Boolean(s.gmail.connection)

  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          Email provider
          <ToneBadge tone={s.ready.ready ? 'success' : 'warning'}>{s.ready.ready ? 'Ready' : 'Not ready'}</ToneBadge>
          <ToneBadge tone="neutral">{s.provider === 'gmail' ? 'Gmail' : 'SMTP'}</ToneBadge>
        </span>
      }
      description={s.ready.ready ? 'Applications can be sent.' : (s.ready.reason ?? 'Sending is not configured yet.')}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Mail className="size-4" /> Gmail
          </p>
          <StatusLine ok={s.gmail.configured} label={s.gmail.configured ? 'OAuth client configured' : 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set'} />
          <StatusLine ok={gmailConnected} label={gmailConnected ? `Connected as ${s.gmail.connection?.email ?? 'unknown'}` : 'Not connected'} detail={s.gmail.connection ? `since ${fmtDateTime(s.gmail.connection.connectedAt)}` : null} />
          <div className="mt-1 flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Redirect URI — add this as an authorised redirect URI in Google Cloud:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">{s.gmail.redirectUri}</code>
              <CopyButton text={s.gmail.redirectUri} size="xs" />
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {s.gmail.configured ? (
              <Button size="sm" nativeButton={false} render={<a href="/api/gmail/connect" />}>
                {gmailConnected ? 'Reconnect Gmail' : 'Connect Gmail'}
              </Button>
            ) : (
              <Button size="sm" disabled>
                Connect Gmail
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy || !gmailConnected} onClick={() => act.mutate('test-gmail')}>
              {pendingAction === 'test-gmail' ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Test Gmail
            </Button>
            {gmailConnected ? (
              <ConfirmButton
                size="sm"
                variant="destructive"
                title="Disconnect Gmail?"
                description="The stored refresh token is deleted. Sending and reply polling stop until you connect again."
                confirmLabel="Disconnect"
                onConfirm={() => act.mutateAsync('disconnect-gmail')}
                disabled={busy}
              >
                <Unplug className="size-3.5" /> Disconnect
              </ConfirmButton>
            ) : null}
          </div>
          {!s.gmail.configured ? <p className="text-xs text-muted-foreground">Set the Google OAuth env vars and restart the app to enable connecting.</p> : null}
          {s.gmail.configured ? (
            <p className="text-xs text-muted-foreground">
              Disconnected every 7 days? The Google OAuth app is still in &quot;Testing&quot;. In Google Cloud open Google Auth Platform → Audience (older console: APIs &amp; Services → OAuth consent screen), click Publish app and confirm, then reconnect once here. A personal app needs no verification: on Google&apos;s &quot;unverified app&quot; screen choose Advanced, then continue.
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Send className="size-4" /> SMTP
          </p>
          <StatusLine ok={s.smtp.configured} label={s.smtp.configured ? 'Configured' : 'Not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)'} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Host</dt>
            <dd className="truncate font-mono text-xs leading-5">{s.smtp.host ?? '—'}</dd>
            <dt className="text-muted-foreground">From</dt>
            <dd className="truncate font-mono text-xs leading-5">{s.smtp.from ?? '—'}</dd>
          </dl>
          <div className="mt-auto flex flex-col gap-1.5 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sent or queued today</span>
              <span className="tabular-nums">
                {s.sentOrQueuedToday} / {s.dailySendCap}
              </span>
            </div>
            <Progress value={capPct} aria-label="Daily send cap usage" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy || !s.ready.ready} onClick={() => act.mutate('test')}>
          {pendingAction === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send test email
        </Button>
        <span className="text-xs text-muted-foreground">Goes to the digest email (or your login email) through the selected provider.</span>
      </div>
    </SectionCard>
  )
}
