import { normalizeQuestion } from '../match'
import type { SourceLinkRef } from '../urls'

/**
 * Greenhouse publishes every job's question list (boards-api ... /jobs/{id}?questions=true). Reading
 * it before the page opens tells the agent what the form asks, and catches a form that can never be
 * answered truthfully (a required country list without the candidate's home country) without spending an attempt on it.
 */

export interface GreenhouseRef {
  token: string
  id: string
}

export interface PrefetchedQuestion {
  label: string
  required: boolean
  /** input_text | textarea | input_file | multi_value_single_select | multi_value_multi_select | input_hidden */
  type: string
  options: string[]
}

/** Board token and job id from the ATS source link or a Greenhouse URL. */
export function greenhouseRef(url: string, links: SourceLinkRef[] = [], companySlug?: string | null): GreenhouseRef | null {
  for (const l of links) {
    const m = l.source === 'ats' ? /^greenhouse:([^:]+):(\d+)$/.exec(l.externalId) : null
    if (m) return { token: m[1], id: m[2] }
  }
  const m = /greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?#&]+)\/jobs\/(\d+)/.exec(url)
  if (m && !/^(embed|v1)$/.test(m[1])) return { token: m[1], id: m[2] }
  const form = /greenhouse\.io\/embed\/job_app\?(?=.*\bfor=([^&#]+))(?=.*\btoken=(\d+))/.exec(url)
  if (form) return { token: form[1], id: form[2] }
  const gh = /[?&]gh_jid=(\d+)/.exec(url)
  if (gh && companySlug) return { token: companySlug, id: gh[1] }
  return null
}

export function parseGreenhouseQuestions(body: unknown): PrefetchedQuestion[] {
  const b = body as { questions?: unknown[]; location_questions?: unknown[] } | null
  const out: PrefetchedQuestion[] = []
  for (const raw of [...(b?.questions ?? []), ...(b?.location_questions ?? [])]) {
    const q = raw as { label?: string; required?: boolean; fields?: Array<{ type?: string; values?: Array<{ label?: string }> }> }
    const field = q.fields?.find((f) => f.type !== 'input_hidden') ?? q.fields?.[0]
    if (!q.label || !field) continue
    out.push({ label: q.label.trim(), required: q.required === true, type: field.type ?? 'input_text', options: (field.values ?? []).map((v) => (v.label ?? '').trim()).filter(Boolean) })
  }
  return out
}

/** The job's questions, or null when Greenhouse does not answer within a few seconds. */
export async function fetchGreenhouseQuestions(ref: GreenhouseRef, fetchImpl: typeof fetch = fetch): Promise<PrefetchedQuestion[] | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const res = await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs/${ref.id}?questions=true`, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return parseGreenhouseQuestions(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const RESIDENCE_RE = /^(in )?(what|which) (country|countries|location|region) (are you|do you) (currently )?(live|living|reside|residing|based|located)|^(country|country of residence|current country|current location|location|where are you (currently )?(based|located)|where do you (currently )?live)\b/
const OTHER_RE = /\b(other|outside|rest of|international|non.?eu|worldwide|anywhere|none of the above)\b/i

/**
 * A required single-choice question about where the person lives whose options leave out their country and offer
 * no "Other": the employer only hires there, and no answer would be true. Returns the reason, or null.
 */
export function prefetchedKnockout(questions: PrefetchedQuestion[], homeCountry: string | null | undefined): string | null {
  if (!homeCountry) return null
  const home = normalizeQuestion(homeCountry)
  for (const q of questions) {
    if (!q.required || q.options.length < 3 || !/select/.test(q.type)) continue
    if (!RESIDENCE_RE.test(normalizeQuestion(q.label))) continue
    if (q.options.some((o) => normalizeQuestion(o).includes(home) || OTHER_RE.test(o))) continue
    return `Not eligible: "${q.label.slice(0, 60)}" only offers ${q.options.slice(0, 4).join(', ')}${q.options.length > 4 ? '…' : ''}`
  }
  return null
}

/** Required questions beyond the standard contact block, for the log ("3 custom questions"). */
export function customQuestionCount(questions: PrefetchedQuestion[]): number {
  return questions.filter((q) => q.required && !/^(first name|last name|email|phone|resume|cv|resume\/cv|cover letter|location|longitude|latitude)$/i.test(q.label)).length
}
