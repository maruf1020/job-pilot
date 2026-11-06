import type { JudgeOutput } from '@/lib/ai/schemas'
import type { AiConfig } from '@/lib/settings/schema'
import { describeJudge, judgeDraft } from './judge'
import { describeLintIssues, lintEmail, type LintContext, type LintResult } from './lint'
import { saplingScore } from './sapling'

export interface DraftVersion {
  subject: string
  body: string
  lint: LintResult
  judge: JudgeOutput | null
  externalAiScore: number | null
  passed: boolean
  /** Feedback that produced this version (empty for the first). */
  feedback: string | null
  generatedBy: string | null
}

export interface HumanizeResult {
  subject: string
  body: string
  passed: boolean
  rounds: number
  versions: DraftVersion[]
}

export interface HumanizeOptions {
  /** Produce a draft; receives the previous draft + findings for rewrite rounds. */
  generate: (rewrite?: { subject: string; body: string; findings: string }) => Promise<{ subject: string; body: string; model?: string }>
  lintCtx: LintContext
  ai: AiConfig
  company: string
  /** Skip the LLM judge (tests / cover letters). */
  skipJudge?: boolean
  /** Run the judge on the cheap model (auto-apply batches). */
  judgeModel?: 'primary' | 'lite'
  log?: (message: string) => void
}

/**
 * draft → autofix → lint → judge → (rewrite with findings) × maxRewriteRounds.
 * Every version is returned so the UI can show what changed.
 */
export async function humanizeLoop(opts: HumanizeOptions): Promise<HumanizeResult> {
  const versions: DraftVersion[] = []
  let feedback: string | null = null
  let previous: { subject: string; body: string } | null = null
  const maxRounds = opts.ai.maxRewriteRounds

  for (let round = 0; round <= maxRounds; round++) {
    const gen = await opts.generate(previous && feedback ? { ...previous, findings: feedback } : undefined)
    const lint = lintEmail(gen.subject, gen.body, opts.lintCtx)
    const subject = lint.fixedSubject
    const body = lint.fixedBody

    let judge: JudgeOutput | null = null
    let externalAiScore: number | null = null
    let passed = lint.passed
    const notes: string[] = []
    if (!lint.passed) notes.push(describeLintIssues(lint))

    if (lint.passed && !opts.skipJudge) {
      try {
        judge = await judgeDraft(subject, body, opts.company, opts.judgeModel ?? 'primary')
        if (judge.aiLikelihood > opts.ai.judgeThreshold) {
          passed = false
          notes.push(`A hiring manager rated this ${judge.aiLikelihood}/100 likely AI-written. Fix these:\n${describeJudge(judge)}`)
        }
      } catch (err) {
        opts.log?.(`judge failed, continuing on lint only: ${err instanceof Error ? err.message : err}`)
      }
    }

    if (passed && opts.ai.saplingEnabled) {
      externalAiScore = await saplingScore(body)
      if (externalAiScore != null && externalAiScore > opts.ai.saplingMaxScore) {
        // Signal, not a gate: keep passing but record it so the review UI can show it.
        opts.log?.(`sapling score ${externalAiScore.toFixed(2)} above ${opts.ai.saplingMaxScore}`)
      }
    }

    versions.push({ subject, body, lint, judge, externalAiScore, passed, feedback, generatedBy: gen.model ?? null })
    opts.log?.(`round ${round}: lint ${lint.errors.length} errors / ${lint.warnings.length} warnings${judge ? `, judge ${judge.aiLikelihood}` : ''} → ${passed ? 'pass' : 'retry'}`)

    if (passed) return { subject, body, passed: true, rounds: round + 1, versions }

    previous = { subject, body }
    feedback = notes.join('\n')
  }

  // Out of rounds: hand back the best version (fewest lint errors, then lowest judge score).
  const best = [...versions].sort(
    (a, b) => a.lint.errors.length - b.lint.errors.length || (a.judge?.aiLikelihood ?? 101) - (b.judge?.aiLikelihood ?? 101),
  )[0]
  return { subject: best.subject, body: best.body, passed: false, rounds: versions.length, versions }
}
