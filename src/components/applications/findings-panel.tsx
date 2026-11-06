'use client'

import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { JudgeOutput } from '@/lib/ai/schemas'
import type { LintIssue } from '@/lib/pipeline/humanize/lint'
import { cn } from '@/lib/utils'
import { ToneBadge } from '@/components/shared/status-badge'
import { aiTone } from './helpers'
import type { StoredLintResult } from './types'

interface FindingsPanelProps {
  lint?: StoredLintResult | null
  judge?: JudgeOutput | null
  externalAiScore?: number | null
  emptyText?: string
}

function IssueList({ issues, severity }: { issues: LintIssue[]; severity: 'error' | 'warn' }) {
  const isError = severity === 'error'
  const Icon = isError ? CircleAlert : TriangleAlert
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((it, i) => (
        <li
          key={`${it.rule}-${i}`}
          className={cn('rounded-md border px-2.5 py-1.5 text-xs', isError ? 'border-destructive/30 bg-danger-soft' : 'border-warning/40 bg-warning-soft')}
        >
          <div className="flex items-start gap-1.5">
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', isError ? 'text-danger-text' : 'text-warning-text')} />
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wide">{it.rule}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{it.where}</span>
              </p>
              <p className="mt-0.5">{it.message}</p>
              {it.match ? <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">&ldquo;{it.match}&rdquo;</p> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

const BAR_CLASS = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive' } as const

function JudgeSection({ judge }: { judge: JudgeOutput }) {
  const tone = aiTone(judge.aiLikelihood)
  const pct = Math.min(100, Math.max(0, judge.aiLikelihood))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToneBadge tone={tone}>AI likelihood {Math.round(judge.aiLikelihood)}%</ToneBadge>
        <span className="text-xs text-muted-foreground">target ≤ 30</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI likelihood">
        <div className={cn('h-full rounded-full', BAR_CLASS[tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'danger'])} style={{ width: `${pct}%` }} />
      </div>
      {judge.tells.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Tells</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {judge.tells.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {judge.suggestions.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {judge.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function FindingsPanel({ lint, judge, externalAiScore, emptyText }: FindingsPanelProps) {
  if (!lint && !judge && externalAiScore == null) {
    return <p className="text-sm text-muted-foreground">{emptyText ?? 'No findings yet. Run Check to lint the draft.'}</p>
  }

  const stats: Array<[string, string | number]> | null = lint?.stats
    ? [
        ['Words', lint.stats.words],
        ['Sentences', lint.stats.sentences],
        ['Paragraphs', lint.stats.paragraphs],
        ['Avg sentence', `${Math.round(lint.stats.avgSentenceLen * 10) / 10} w`],
      ]
    : null

  return (
    <div className="flex flex-col gap-4 text-sm">
      {lint ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ToneBadge tone={lint.passed ? 'success' : 'danger'}>{lint.passed ? '✓ Lint passed' : '✗ Lint failed'}</ToneBadge>
            <span className="text-xs text-muted-foreground">
              {lint.errors.length} error{lint.errors.length === 1 ? '' : 's'} · {lint.warnings.length} warning{lint.warnings.length === 1 ? '' : 's'}
            </span>
          </div>
          {lint.errors.length > 0 ? <IssueList issues={lint.errors} severity="error" /> : null}
          {lint.warnings.length > 0 ? <IssueList issues={lint.warnings} severity="warn" /> : null}
          {stats ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stats.map(([k, v]) => (
                <div key={k} className="rounded-md bg-muted px-2.5 py-1.5">
                  <dt className="text-[11px] text-muted-foreground">{k}</dt>
                  <dd className="font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
      {judge ? <JudgeSection judge={judge} /> : null}
      {externalAiScore != null ? (
        <p className="text-xs text-muted-foreground">
          External AI detector score: <span className="font-medium tabular-nums text-foreground">{Math.round(externalAiScore)}</span>
        </p>
      ) : null}
    </div>
  )
}
