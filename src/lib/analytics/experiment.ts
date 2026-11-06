import { PROMPT_VERSION } from '@/lib/ai/prompts'

/** What a send tried, stored on `Application.experiment` so the scoreboard can compare variants. */
export interface Experiment {
  promptVersion?: string | null
  model?: string | null
  cvAttached?: boolean
  subjectStyle?: string
  words?: number
  sentBy?: 'batch' | 'auto' | 'you'
  channel?: 'email' | 'form'
  site?: string | null
}

/** Rough subject style, so two subject lines can be compared later. */
export function subjectStyle(subject: string, jobTitle: string): string {
  const s = subject.toLowerCase()
  if (s.includes('?')) return 'question'
  const words = jobTitle.toLowerCase().split(/\W+/).filter((w) => w.length > 2).slice(0, 3)
  if (words.length && words.every((w) => s.includes(w))) return 'role title'
  return 'other'
}

export function sentByOf(app: { batchId: string | null; autoRetry: boolean }): 'batch' | 'auto' | 'you' {
  return app.batchId ? 'batch' : app.autoRetry ? 'auto' : 'you'
}

export function emailExperiment(input: { subject: string; body: string; jobTitle: string; promptVersion: string | null; model: string | null; cvAttached: boolean; batchId: string | null; autoRetry: boolean }): Experiment {
  return {
    channel: 'email',
    promptVersion: input.promptVersion ?? PROMPT_VERSION,
    model: input.model,
    cvAttached: input.cvAttached,
    subjectStyle: subjectStyle(input.subject, input.jobTitle),
    words: input.body.trim().split(/\s+/).length,
    sentBy: sentByOf(input),
  }
}

export function formExperiment(input: { site: string | null; by: 'agent' | 'manual'; batchId: string | null }): Experiment {
  return { channel: 'form', site: input.site, promptVersion: PROMPT_VERSION, sentBy: input.by === 'manual' ? 'you' : input.batchId ? 'batch' : 'you' }
}
