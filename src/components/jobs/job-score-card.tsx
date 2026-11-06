'use client'

import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'
import { Section } from '@/components/shared/section'
import { SponsorshipBadge, ToneBadge } from '@/components/shared/status-badge'
import { fmtDateTime, scoreTone, type BadgeTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { parseBreakdown, type JobDetail, type JobScoreDetail } from './types'

const SCORE_TEXT: Record<BadgeTone, string> = {
  success: 'text-success-text',
  accent: 'text-primary-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  muted: 'text-muted-foreground',
  neutral: 'text-foreground',
  info: 'text-info-text',
}

const SCORE_BAR: Record<BadgeTone, string> = {
  success: 'bg-success',
  accent: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground/50',
  neutral: 'bg-foreground/60',
  info: 'bg-info',
}

function signed(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `-${Math.abs(n)}`
  return '0'
}

function BulletList({ heading, items, icon }: { heading: string; items: string[]; icon: React.ReactNode }) {
  if (items.length === 0) return null
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{heading}</p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((text, i) => (
          <li key={i} className="flex gap-2">
            {icon}
            <span className="min-w-0 wrap-break-word">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Score: the number, how it was built (rule points), the fit hook, and why it fits or not. */
export function JobScoreCard({ score }: { score: JobScoreDetail | null }) {
  if (!score) {
    return (
      <Section title="Score" description="Not scored yet. It is ranked on the next run, or use More, Enrich and score again.">
        <p className="text-sm text-muted-foreground">No breakdown yet.</p>
      </Section>
    )
  }
  const lines = parseBreakdown(score.breakdown)
  const tone = scoreTone(score.finalScore)
  return (
    <Section title="Score" description={`Rules ${score.ruleScore} · AI fit ${score.llmScore ?? '-'}${score.model ? ` · ${score.model}` : ''} · ${fmtDateTime(score.scoredAt)}`}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <span className={cn('text-5xl leading-none font-semibold tracking-tight tabular-nums', SCORE_TEXT[tone])}>{score.finalScore}</span>
          <div className="min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Score ${score.finalScore} of 100`}>
              <div className={cn('h-full rounded-full', SCORE_BAR[tone])} style={{ width: `${Math.max(2, Math.min(100, score.finalScore))}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">out of 100 · 60% rules, 40% AI fit</p>
          </div>
        </div>

        {score.hook ? <blockquote className="border-l-2 border-primary pl-3 text-sm leading-relaxed text-foreground">{score.hook}</blockquote> : null}

        {lines.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Breakdown</p>
            <ul className="divide-y rounded-md border">
              {lines.map((l, i) => (
                <li key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground">{l.label}</p>
                    {l.detail ? <p className="text-xs wrap-break-word text-muted-foreground">{l.detail}</p> : null}
                  </div>
                  <span className={cn('shrink-0 font-mono text-xs font-medium tabular-nums', l.points > 0 ? 'text-success-text' : l.points < 0 ? 'text-danger-text' : 'text-muted-foreground')}>{signed(l.points)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {score.reasons.length || score.gaps.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <BulletList heading="Why it fits" items={score.reasons} icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-text" />} />
            <BulletList heading="Gaps" items={score.gaps} icon={<AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" />} />
          </div>
        ) : null}
      </div>
    </Section>
  )
}

/** Sponsorship: the level, the signals around it, and the posting's own words as evidence. */
export function SponsorshipCard({ job }: { job: JobDetail }) {
  return (
    <Section
      title="Sponsorship"
      actions={
        <div className="flex flex-wrap justify-end gap-1.5">
          <SponsorshipBadge level={job.sponsorship} />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {job.visaFlag || job.relocationSupport || job.company.knownSponsor ? (
          <div className="flex flex-wrap gap-1.5">
            {job.company.knownSponsor ? (
              <ToneBadge tone="success">
                <ShieldCheck className="size-3" /> Known sponsor
              </ToneBadge>
            ) : null}
            {job.visaFlag ? <ToneBadge tone="success">Source flags visa support</ToneBadge> : null}
            {job.relocationSupport ? <ToneBadge tone="info">Relocation support</ToneBadge> : null}
          </div>
        ) : null}
        {job.sponsorshipEvidence.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {job.sponsorshipEvidence.map((quote, i) => (
              <li key={i} className="border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-muted-foreground">
                &quot;{quote}&quot;
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">The posting says nothing about sponsorship.</p>
        )}
      </div>
    </Section>
  )
}
