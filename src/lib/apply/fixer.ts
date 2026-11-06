import path from 'node:path'
import type { Page } from 'playwright'
import { generateJson } from '@/lib/ai/gemini'
import { DEFAULT_AI } from '@/lib/settings/schema'
import { formFixPrompt, type ProfileForPrompt } from '@/lib/ai/prompts'
import { formFixSchema } from '@/lib/ai/schemas'
import { workRightsSentence, type CandidateContext } from '@/lib/candidate/context'
import { loadCandidateContext } from '@/lib/candidate/load'
import { applyPlan } from './fill'
import { resumeFilePath } from './files'
import { fixLessonsFor, keepFixLesson } from './lessons'
import { truthfulWorkAnswer } from './work-rights'
import { hostOf, normalizeQuestion } from './match'
import { clickAndFollow, relevantFields, scanPage, settle } from './navigate'
import type { AnswerBank } from './answer-bank'
import type { PlannedAnswer, ScannedField } from './types'

/**
 * A second look at a form an agent got stuck on, right after it stopped: the AI reads the screenshot and
 * what the scanner saw, a few small steps are tried (a pop-up's Agree, a format fix, a missed option),
 * and the agent continues. What it learns per site is kept for the next look (SiteLesson, type 'fix').
 */

/** Stops a second look can help with: the form is open and something on it blocks the way. */
export function worthASecondLook(reason: string): boolean {
  if (/captcha|sign in|log in|account|password|emailed you|code it emailed|no confirmation|already|a file only you have|bot|access|restricted|403/i.test(reason)) return false
  // "Needs your answer" too: the AI reads the question on the page and answers from the saved facts, or stops.
  return /could not find a next or submit|does not move past|pressed submit|could not fill|did not stick|stays disabled|more pages than expected|still loading|needs your answer|could not read this question/i.test(reason)
}

/** Buttons the agent presses itself, or that need you: never from a second look. */
const NOT_FOR_FIXER = /submit|apply|send|sign ?up|register|create (an )?account|log ?in|sign ?in|subscribe|delete|remove|withdraw/i
/** Buttons that open the system file picker. */
const FILE_BUTTON = /choose files?|browse|upload|attach|select files?|drop (your |a |the )?(file|cv|resume)|add (a )?(file|cv|resume)|subir|adjuntar|cargar|hochladen|anhängen|télécharger|joindre|uploaden|carica|carregar|anexar/i
/** Answers that come only from the person's own saved answers and the rules. */
const PROTECTED = /citizen|nationality|salary|compensation|gender|sex\b|orientation|ethnic|race|religio|disab|neurodiverg|caring|date of birth|birthday|\bage\b|password/i

export { CLAIMS_RIGHT, claimsFalseRight, truthfulWorkAnswer } from './work-rights'

/**
 * The person's standard details and real jobs as plain facts for the AI (a job title or school typed into a
 * work-history box must be one the person actually had: a model once guessed "Full-Stack Engineer").
 */
function factsFrom(bank: AnswerBank, email: string, fullName: string, ctx: CandidateContext, countryCode: string | null | undefined, profile?: ProfileForPrompt): string[] {
  const facts = [`Full name: ${fullName}`, `Email: ${email}`]
  for (const e of profile?.experience ?? ctx.experience) facts.push(`Job: "${e.title}" at ${e.company}, ${e.from ?? '?'} to ${e.to ?? 'now'} (use this exact title)`)
  for (const r of bank.rows) {
    if (!r.key.startsWith('std:') || !r.answer || PROTECTED.test(`${r.key} ${r.question}`)) continue
    facts.push(`${r.question}: ${r.answer}`)
  }
  facts.push(`Right to work: ${workRightsSentence(ctx, countryCode)}`)
  return facts.slice(0, 46)
}

const findField = (fields: ScannedField[], target: string) => {
  const t = normalizeQuestion(target)
  return fields.find((f) => normalizeQuestion(f.label) === t) ?? fields.find((f) => t.length >= 4 && normalizeQuestion(f.label).includes(t))
}

/**
 * Look at the stuck form and try the suggested steps. True when at least one step was done, so the
 * agent's form loop runs again; false leaves the stop as it was.
 */
export async function secondLook(input: {
  page: Page
  reason: string
  recentLog: string[]
  job: { title: string; company: string; countryCode?: string | null }
  bank: AnswerBank
  email: string
  fullName: string
  profile?: ProfileForPrompt
  log: (m: string) => void
  onAiCall?: () => void
}): Promise<boolean> {
  const { page, log } = input
  if (page.isClosed()) return false
  const { scan, frames } = await scanPage(page)
  const fields = relevantFields(scan).filter((f) => f.visible && f.kind !== 'file' && f.kind !== 'password')
  const shot = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 45, timeout: 20_000 }).catch(() => null)
  const host = hostOf(page.url())
  const ctx = input.profile?.candidate ?? (await loadCandidateContext())
  const cc = input.job.countryCode ?? null
  const p = formFixPrompt({
    job: { title: input.job.title, company: input.job.company, countryCode: cc },
    candidate: ctx,
    reason: input.reason,
    url: page.url(),
    recentLog: input.recentLog.slice(-12),
    fields: fields.slice(0, 60).map((f) => ({ label: f.label, kind: f.kind, value: f.value.slice(0, 120), required: f.required, ...(f.error ? { error: f.error } : {}), ...(f.options.length ? { options: f.options.slice(0, 15).map((o) => o.label) } : {}) })),
    buttons: scan.buttons.filter((b) => b.visible).slice(0, 30).map((b) => ({ text: b.text.slice(0, 80), kind: b.kind, disabled: b.disabled })),
    errors: scan.errors.slice(0, 8),
    pageText: scan.textSample,
    facts: factsFrom(input.bank, input.email, input.fullName, ctx, cc, input.profile),
    lessons: await fixLessonsFor(host, ctx),
  })
  // The full Flash model reads screenshots best but has ~20 free calls a day per key; the lite one takes over after.
  const ask = (model: string) => {
    input.onAiCall?.()
    return generateJson({
      task: 'form_fix',
      model,
      schema: formFixSchema,
      system: p.system,
      prompt: p.prompt,
      temperature: 0.2,
      maxOutputTokens: 4096,
      ...(shot ? { images: [{ mimeType: 'image/jpeg', data: shot.toString('base64') }] } : {}),
    })
  }
  const r = await ask(DEFAULT_AI.models.primary).catch(() => ask('lite'))
  const fix = r.data
  log(`second look: ${fix.diagnosis}`)
  let done = 0
  for (const a of fix.actions) {
    if (a.type === 'wait') {
      await settle(page, 5000)
      done++
      continue
    }
    if (a.type === 'click') {
      const b = scan.buttons.find((x) => x.visible && !x.disabled && normalizeQuestion(x.text) === normalizeQuestion(a.target)) ?? scan.buttons.find((x) => x.visible && !x.disabled && normalizeQuestion(x.text).includes(normalizeQuestion(a.target)))
      if (!b || NOT_FOR_FIXER.test(b.text)) {
        log(`second look: skipped clicking "${a.target}"`)
        continue
      }
      // An upload button opens the system file picker (on your screen, in your Chrome): put the CV in the
      // empty upload box directly instead, as the agent does.
      if (FILE_BUTTON.test(b.text)) {
        const box = relevantFields(scan).find((f) => f.kind === 'file' && !f.value)
        const cv = box ? await resumeFilePath().catch(() => null) : null
        const res = box && cv ? await applyPlan(frames, relevantFields(scan), [{ key: box.key, label: box.label, kind: 'file', value: path.basename(cv), file: cv, source: 'resume', required: box.required }], () => undefined).catch(() => ({ filled: 0, failed: [] })) : { filled: 0 }
        log(`second look: ${res.filled ? `put the CV in "${box!.label.slice(0, 50)}"` : `skipped "${b.text.slice(0, 40)}" (no empty upload box)`}`)
        if (res.filled) done++
        continue
      }
      await clickAndFollow(page, frames, b).catch(() => page)
      await settle(page, 900)
      log(`second look: clicked "${b.text.slice(0, 60)}"`)
      done++
      continue
    }
    const f = findField(fields, a.target)
    if (!f || PROTECTED.test(f.label) || (a.type !== 'check' && !a.value) || !truthfulWorkAnswer(f.label, a.value ?? '', ctx, cc)) {
      log(`second look: skipped "${a.target}"${f && (PROTECTED.test(f.label) || !truthfulWorkAnswer(f.label, a.value ?? '', ctx, cc)) ? ' (answered only from your saved answers)' : ''}`)
      continue
    }
    const answer: PlannedAnswer =
      a.type === 'check'
        ? { key: f.key, label: f.label, kind: f.kind, value: 'Yes', checked: true, source: 'ai', required: f.required }
        : { key: f.key, label: f.label, kind: f.kind, value: a.value!, source: 'ai', required: f.required }
    const res = await applyPlan(frames, fields, [answer], () => undefined).catch(() => ({ filled: 0, failed: [] }))
    log(`second look: ${a.type} "${f.label.slice(0, 60)}"${a.value ? ` = "${a.value.slice(0, 60)}"` : ''}${res.filled ? '' : ' (did not take)'}`)
    if (res.filled) done++
  }
  await keepFixLesson({ host, lesson: fix.lesson, diagnosis: fix.diagnosis, reason: input.reason, done }, ctx)
  return done > 0
}
