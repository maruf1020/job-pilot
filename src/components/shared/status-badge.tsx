import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { APP_STATUS_LABEL, JOB_STATUS_LABEL, REPLY_LABEL, RUN_STATUS_LABEL, scoreTone, SPONSORSHIP_LABEL, type BadgeTone } from '@/lib/format'
import type { ApplicationStatus, JobStatus, ReplyClassification, RunStatus, SponsorshipLevel } from '@/lib/domain'

/** One mapping from tone to the semantic tokens (plan-ui-redesign.md 3.2). No raw palette colours in pages. */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  info: 'bg-info-soft text-info-text',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger-text',
  muted: 'bg-muted text-muted-foreground',
  accent: 'bg-primary-soft text-primary-text',
}

const DOT_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-foreground/50',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground/60',
  accent: 'bg-primary',
}

export function toneClass(tone: BadgeTone): string {
  return TONE_CLASS[tone]
}

/** Status pill: small rounded rectangle, optional leading dot. */
export function ToneBadge({ tone, children, className, dot }: { tone: BadgeTone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <Badge variant="ghost" className={cn('h-5 gap-1.5 rounded-md border-0 px-1.5 font-medium whitespace-nowrap hover:bg-[unset]', TONE_CLASS[tone], className)}>
      {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', DOT_CLASS[tone])} /> : null}
      {children}
    </Badge>
  )
}

/** Just the coloured dot (dense lists, timelines). */
export function StatusDot({ tone, className, label }: { tone: BadgeTone; className?: string; label?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('inline-block size-2 shrink-0 rounded-full', DOT_CLASS[tone], className)} />
}

export function JobStatusBadge({ status }: { status: string }) {
  const m = JOB_STATUS_LABEL[status as JobStatus] ?? { label: status, tone: 'neutral' as const }
  return (
    <ToneBadge tone={m.tone} dot>
      {m.label}
    </ToneBadge>
  )
}

export function AppStatusBadge({ status }: { status: string }) {
  const m = APP_STATUS_LABEL[status as ApplicationStatus] ?? { label: status, tone: 'neutral' as const }
  return (
    <ToneBadge tone={m.tone} dot>
      {m.label}
    </ToneBadge>
  )
}

export function RunStatusBadge({ status }: { status: string }) {
  const m = RUN_STATUS_LABEL[status as RunStatus] ?? { label: status, tone: 'neutral' as const }
  return (
    <ToneBadge tone={m.tone} dot>
      {m.label}
    </ToneBadge>
  )
}

/** Browser-agent attempt statuses (PortalAttempt.status). */
export const ATTEMPT_STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: 'Queued', tone: 'muted' },
  RUNNING: { label: 'Filling', tone: 'info' },
  AWAITING_REVIEW: { label: 'Ready to submit', tone: 'accent' },
  SUBMITTED: { label: 'Submitted', tone: 'success' },
  NEEDS_HUMAN: { label: 'Needs you', tone: 'warning' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
}

export function AttemptStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null
  const m = ATTEMPT_STATUS_LABEL[status] ?? { label: status, tone: 'neutral' as const }
  return (
    <ToneBadge tone={m.tone} dot>
      {m.label}
    </ToneBadge>
  )
}

export function SponsorshipBadge({ level }: { level: string }) {
  const m = SPONSORSHIP_LABEL[level as SponsorshipLevel] ?? { label: level, tone: 'neutral' as const }
  return <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
}

export function ReplyBadge({ classification }: { classification: string | null | undefined }) {
  if (!classification) return <ToneBadge tone="muted">Unclassified</ToneBadge>
  const m = REPLY_LABEL[classification as ReplyClassification] ?? { label: classification, tone: 'neutral' as const }
  return <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
}

/** Fit score: a number in a tinted square, tone by band (78+ strong, 60+ fit, 45+ weak). */
export function ScoreBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className={cn('text-xs text-muted-foreground', className)}>-</span>
  return (
    <ToneBadge tone={scoreTone(score)} className={cn('min-w-9 justify-center font-semibold tabular-nums', className)}>
      {score}
    </ToneBadge>
  )
}

export function ChannelBadge({ channel }: { channel: string }) {
  const label = channel === 'email' ? 'Email' : channel === 'ats' ? 'ATS form' : channel === 'portal' ? 'Portal' : 'Unknown'
  return <ToneBadge tone={channel === 'email' ? 'info' : channel === 'unknown' ? 'muted' : 'neutral'}>{label}</ToneBadge>
}
