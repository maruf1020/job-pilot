import { generateJson } from '@/lib/ai/gemini'
import { countryName } from '@/lib/domain'
import { formAnswersPrompt, rewriteFormTextPrompt, type FormFieldForPrompt, type JobForPrompt, type ProfileForPrompt } from '@/lib/ai/prompts'
import type { BannedPhraseSeed } from '@/lib/pipeline/humanize/banned-phrases'
import { checkFreeText } from '@/lib/pipeline/humanize/free-text'
import { getBannedPhrases } from '@/lib/pipeline/humanize/phrases'
import { formAnswersSchema } from '@/lib/ai/schemas'
import { cleanOptions, isStandardKey, rememberAnswer, STANDARD_ENTRIES, unreadableLabel } from './answer-bank'
import { matchOption, normalizeQuestion } from './match'
import { hasAddressParts, hasPhoneCountryPicker, isDocumentChoice, onlyDialCode, pickResumeOption, resolveStandard, worthAsking, wrongDialCode, type StandardContext } from './standard'
import type { AnswerSource, OpenQuestion, PlannedAnswer, ScannedField } from './types'

/**
 * Decide what goes into each field of one form page:
 * rules (profile/standard details) → answer bank → one AI call for the rest.
 * Required questions that nobody can answer truthfully become open questions for you.
 */

export interface PlanContext extends StandardContext {
  profile: ProfileForPrompt
  job: JobForPrompt
  company: string
  /** Allowed to call the AI at all (false in tests / when the quota is gone). */
  useAi: boolean
  /** Use the primary model for essay questions (else lite). */
  primaryOk: boolean
  /** Answers from an earlier attempt for this application, by normalised label (re-fill without AI). */
  cached?: Map<string, PlannedAnswer>
  /** Re-answer these keys even though they have a value (the site showed an error). */
  retryKeys?: Set<string>
  onAiCall?: () => void
  /** Save reusable AI answers in the answer bank (default true; off in tests). */
  remember?: boolean
  /** Test hook: replaces the AI call. */
  aiAnswer?: (fields: FormFieldForPrompt[]) => Promise<Array<{ key: string; value: string | null; choices: string[] | null; needsHuman: boolean; reason: string | null }>>
  /** Banned phrases for written answers (default: Settings → AI list). */
  bannedPhrases?: BannedPhraseSeed[]
  /** Test hook: replaces the one rewrite call for written answers that kept a banned phrase. */
  rewriteText?: (items: RewriteItem[]) => Promise<Array<{ key: string; text: string }>>
}

export interface RewriteItem {
  key: string
  label: string
  text: string
  avoid: string[]
  maxLength: number | null
}

/** Where a written answer came from that the agent itself wrote (your own answers in the bank are left alone). */
const WRITTEN_SOURCES = new Set<AnswerSource>(['ai', 'cover_letter', 'cached'])

function isWrittenText(a: PlannedAnswer, f: ScannedField | undefined): boolean {
  if (!f || a.file || a.checked !== undefined || a.choices) return false
  if (f.kind !== 'text' && f.kind !== 'textarea') return false
  return WRITTEN_SOURCES.has(a.source) && a.value.trim().length >= 15
}

export interface PagePlan {
  answers: PlannedAnswer[]
  open: OpenQuestion[]
  skipped: Array<{ label: string; reason: string }>
  aiCalls: number
}

const CHOICE_KINDS = new Set(['select', 'radio', 'combobox', 'listbox', 'buttons'])
const ESSAY_RE = /\b(why|describe|tell us|explain|motivat|interest(ed)?|what (excites|attracts|draws)|cover letter|about yourself|share|example|project|challenge|achievement|proud)\b/i

/** Plain everyday punctuation (the same rule as the emails) and the field's length limit. */
export function tidyText(s: string, maxLength?: number | null): string {
  let t = s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    .replace(/\s*[—–]\s*/g, ' - ')
    .replace(/…/g, '...')
    // SmartRecruiters refuses ";" in its text boxes ("This field cannot contain following characters: ;").
    .replace(/\s*;\s*/g, ', ')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (maxLength && maxLength > 0 && t.length > maxLength) {
    const cut = t.slice(0, maxLength)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'))
    t = end > maxLength * 0.6 ? cut.slice(0, end + 1) : cut.trim()
  }
  return t
}

function isFilled(f: ScannedField): boolean {
  if (f.kind === 'checkbox') return false // decided every time (consents)
  // A resume list whose pre-selected document is not the CV (LinkedIn picks the newest upload, a cover
  // letter once) counts as empty, so the CV gets picked.
  if ((f.kind === 'radio' || f.kind === 'select') && isDocumentChoice([f.label, ...f.options.map((o) => o.label)])) {
    return !!f.value.trim() && f.value === pickResumeOption(f.options.map((o) => o.label), '')
  }
  return f.value.trim().length > 0
}

function fromResolution(f: ScannedField, r: Exclude<ReturnType<typeof resolveStandard>, null>): PlannedAnswer | null {
  const base = { key: f.key, label: f.label, kind: f.kind, required: f.required }
  switch (r.type) {
    case 'value':
      // Ashby asks single-answer questions ("How many years...") as a checkbox group: tick that one box.
      if (f.kind === 'checkboxes') return { ...base, value: r.value, choices: [r.value], source: r.source }
      return { ...base, value: CHOICE_KINDS.has(f.kind) ? r.value : tidyText(r.value, f.maxLength), source: r.source, ...(r.fallbacks?.length ? { fallbacks: r.fallbacks } : {}), ...(r.within ? { within: r.within } : {}) }
    case 'choices':
      return { ...base, value: r.choices.join('; '), choices: r.choices, source: r.source }
    case 'checked':
      return { ...base, value: r.checked ? 'Yes' : 'No', checked: r.checked, source: r.source }
    case 'file':
      return { ...base, value: r.path.split(/[\\/]/).pop() ?? 'file', file: r.path, source: r.source }
    default:
      return null
  }
}

/** Convert a free answer (bank or AI) into what the field accepts; null when it cannot be used. */
export function fitAnswer(f: ScannedField, value: string | null, choices: string[] | null, source: AnswerSource): PlannedAnswer | null {
  const base = { key: f.key, label: f.label, kind: f.kind, required: f.required, source }
  const opts = f.options.map((o) => o.label)
  if (f.kind === 'checkbox') {
    if (value === null) return null
    const yes = /^(yes|true|checked|tick|agree|1)$/i.test(value.trim())
    return { ...base, value: yes ? 'Yes' : 'No', checked: yes }
  }
  if (f.kind === 'checkboxes') {
    const wanted = choices?.length ? choices : value ? value.split(/;|\n/).map((s) => s.trim()) : []
    const matched = wanted.map((w) => matchOption(w, opts)).filter((m): m is string => Boolean(m))
    return matched.length ? { ...base, value: matched.join('; '), choices: [...new Set(matched)] } : null
  }
  if (value === null || value.trim() === '') return null
  if (CHOICE_KINDS.has(f.kind)) {
    if (opts.length === 0) return { ...base, value: value.trim() } // typed into a combobox; the filler picks the option
    const m = matchOption(value, opts)
    return m ? { ...base, value: m } : null
  }
  if (f.kind === 'number') {
    const n = value.replace(/[^\d.,-]/g, '').replace(/,/g, '')
    return n ? { ...base, value: n } : null
  }
  return { ...base, value: tidyText(value, f.maxLength) }
}

export async function planAnswers(fields: ScannedField[], ctx: PlanContext): Promise<PagePlan> {
  const answers: PlannedAnswer[] = []
  const open: OpenQuestion[] = []
  const skipped: Array<{ label: string; reason: string }> = []
  const forAi: ScannedField[] = []

  const openQ = (f: ScannedField, reason: string, stdKey?: string) =>
    open.push({ label: f.label || f.name || 'Unnamed field', kind: f.kind, options: cleanOptions(f.options.map((o) => o.label), f.label).slice(0, 30), required: f.required, reason, ...(stdKey?.startsWith('std:') ? { stdKey } : {}) })
  // A dial-code picker next to the phone box: the box then wants the national number only.
  ctx = { ...ctx, phoneHasCountryPicker: ctx.phoneHasCountryPicker ?? hasPhoneCountryPicker(fields), phoneTypesDialCode: ctx.phoneTypesDialCode ?? fields.some(onlyDialCode), addressHasParts: ctx.addressHasParts ?? hasAddressParts(fields), jobLocation: ctx.jobLocation ?? ctx.job.location, jobCountry: ctx.jobCountry ?? (ctx.job.countryCode ? countryName(ctx.job.countryCode) : null), jobCountryCode: ctx.jobCountryCode ?? ctx.job.countryCode ?? null, candidate: ctx.candidate ?? ctx.profile.candidate }

  for (const f of fields) {
    if (f.disabled || f.kind === 'password') continue
    if (!f.visible && f.kind !== 'file') continue
    // A header sign-in box ("Log in here if you previously have applied...: Email", hr-manager/Talentech): typing
    // the person's email there opened a login dialog and every later click timed out (6 of 6 attempts).
    // Only the login's own email/username box: "Have you previously applied to us?" is a real question.
    if (/^log ?in here|previously (have )?applied|already have an? (account|profile)|^sign ?in\b|existing (user|candidate)s?\b/i.test(f.label) && /e-?mail|user ?name|log ?in id/i.test(f.label) && f.kind !== 'radio' && f.kind !== 'select') {
      skipped.push({ label: f.label, reason: 'sign-in box' })
      continue
    }
    const retry = ctx.retryKeys?.has(f.key) ?? false
    if (isFilled(f) && !retry && !onlyDialCode(f) && !wrongDialCode(f, ctx.bank.std('phone') || ctx.candidate?.phoneIntl || null, ctx.bank.std('phone_country') || ctx.bank.std('country') || ctx.candidate?.countryName || null)) continue
    // A limit shown only as a counter after typing ("Invalid input 36/20", "36 of 20 characters"): keep to it.
    const counted = /\b(\d+)\s*(?:\/|of)\s*(\d+)\b/i.exec(f.error ?? '')
    if (!f.maxLength && counted && Number(counted[1]) > Number(counted[2])) f.maxLength = Number(counted[2])

    // A box whose question could not be read gets no guess: at Version 1 thirteen unlabeled boxes got answers
    // by position ("5" as the salary, a sentence as the postcode, "I am an Irish Citizen").
    // Radio groups with no readable question fall back to an element id ("radio-group-_r_46_"): no guess there either.
    if (f.kind !== 'file' && (!/\p{L}{2}/u.test(f.label) || ((f.kind === 'radio' || f.kind === 'checkboxes' || f.kind === 'buttons') && unreadableLabel(f.label)))) {
      if (f.required) openQ(f, 'The agent could not read this question, so it did not guess an answer')
      else skipped.push({ label: f.label, reason: 'question not readable' })
      continue
    }

    // Rules first, then answers from an earlier attempt: a fixed rule (monthly salary, dates) beats an old wrong answer.
    const r = resolveStandard(f, ctx)
    const ruled = r && r.type !== 'pending' && r.type !== 'skip' ? fromResolution(f, r) : null
    if (ruled) {
      answers.push(ruled)
      continue
    }
    const cached = ctx.cached?.get(normalizeQuestion(f.label))
    if (cached && cached.kind === f.kind && !retry && r?.type !== 'skip') {
      answers.push({ ...cached, key: f.key, source: 'cached' })
      continue
    }

    if (r) {
      if (r.type === 'pending') {
        // An answer saved under this exact wording still counts.
        const saved = ctx.bank.lookup(f.label)
        const a = saved?.answer ? fitAnswer(f, saved.answer, null, 'bank') : null
        if (a) answers.push(a)
        else openQ(f, r.reason, r.stdKey)
        continue
      }
      if (r.type === 'skip') {
        skipped.push({ label: f.label, reason: r.reason })
        continue
      }
      const a = fromResolution(f, r)
      if (a) {
        answers.push(a)
        continue
      }
    }

    // An upload takes a file, never text: a saved or AI answer to its (borrowed) label typed a name into it.
    if (f.kind === 'file') {
      if (f.required) openQ(f, 'An upload the agent has no file for')
      else skipped.push({ label: f.label, reason: 'optional attachment' })
      continue
    }

    const saved = ctx.bank.lookup(f.label)
    if (saved && !isStandardKey(saved.key)) {
      if (saved.answer === null) {
        // Seen before without an answer: let the AI try (it stops only for personal facts); you can still answer it in the bank.
        if (f.required) forAi.push(f)
        else skipped.push({ label: f.label, reason: 'waiting for your answer' })
        continue
      }
      if (saved.answer === '') {
        if (!f.required) {
          skipped.push({ label: f.label, reason: 'left blank by choice' })
          continue
        }
      } else {
        const a = fitAnswer(f, saved.answer, null, 'bank')
        if (a) {
          answers.push(a)
          continue
        }
      }
    }

    if (worthAsking(f)) forAi.push(f)
    else skipped.push({ label: f.label, reason: 'optional' })
  }

  let aiCalls = 0
  let phrases: BannedPhraseSeed[] | undefined
  const loadPhrases = async () => (phrases ??= ctx.bannedPhrases ?? (await getBannedPhrases()))
  /** Written answers that still hold a banned phrase after the swaps: one rewrite, else they wait for the user. */
  const toFix: Array<{ a: PlannedAnswer; f: ScannedField; problems: string[] }> = []
  const checkWritten = async (a: PlannedAnswer, f: ScannedField): Promise<boolean> => {
    const c = checkFreeText(a.value, await loadPhrases())
    a.value = tidyText(c.text, f.maxLength)
    if (c.problems.length) toFix.push({ a, f, problems: c.problems })
    return c.problems.length === 0
  }
  if (forAi.length && !ctx.useAi) {
    for (const f of forAi) if (f.required) openQ(f, 'AI is not available right now')
  } else if (forAi.length) {
    const results = await askAi(forAi, ctx)
    aiCalls = results.calls
    const byKey = new Map(results.items.map((r) => [r.key, r]))
    for (const f of forAi) {
      const r = byKey.get(f.key)
      if (!r || r.needsHuman || (r.value === null && !r.choices?.length)) {
        if (f.required) openQ(f, r?.reason || 'The AI could not answer this truthfully from your profile')
        else skipped.push({ label: f.label, reason: r?.reason || 'no answer' })
        continue
      }
      const a = fitAnswer(f, r.value, r.choices, 'ai')
      if (!a) {
        if (f.required) openQ(f, `The AI answer "${(r.value ?? '').slice(0, 60)}" does not fit the options`)
        else skipped.push({ label: f.label, reason: 'answer did not fit' })
        continue
      }
      const planned: PlannedAnswer = { ...a, confidence: 0.8 }
      // Same rules as the emails before anything is typed or saved (a submitted answer once said "eager").
      const clean = isWrittenText(planned, f) ? await checkWritten(planned, f) : true
      answers.push(planned)
      // Reusable answers (not essays, not company-specific) go to the bank for next time.
      const essay = f.kind === 'textarea' || ESSAY_RE.test(f.label) || f.label.toLowerCase().includes(ctx.company.toLowerCase())
      if (clean && !essay && planned.value.length <= 200 && ctx.remember !== false) await rememberAnswer(f.label, f.kind, f.options.map((o) => o.label), planned.value, ctx.company).catch(() => undefined)
    }
  }

  // The cover letter pasted into a box and answers re-used from an earlier attempt get the same check.
  const fieldByKey = new Map(fields.map((f) => [f.key, f]))
  for (const a of answers) {
    const f = fieldByKey.get(a.key)
    if (a.source !== 'ai' && isWrittenText(a, f)) await checkWritten(a, f!)
  }
  if (toFix.length) {
    let fixed = new Map<string, string>()
    if (ctx.useAi) {
      const items: RewriteItem[] = toFix.map(({ a, f, problems }) => ({ key: a.key, label: f.label.slice(0, 200), text: a.value, avoid: problems, maxLength: f.maxLength }))
      try {
        const out = ctx.rewriteText ? await ctx.rewriteText(items) : await rewriteWritten(items, ctx)
        if (!ctx.rewriteText) aiCalls++
        fixed = new Map(out.map((o) => [o.key, o.text]))
      } catch {
        // No rewrite: the texts below wait for the user instead of going out with a banned phrase.
      }
    }
    for (const { a, f, problems } of toFix) {
      const again = fixed.has(a.key) ? checkFreeText(fixed.get(a.key)!, await loadPhrases()) : null
      if (again && !again.problems.length) {
        a.value = tidyText(again.text, f.maxLength)
        continue
      }
      // Never typed with a banned phrase: a required box waits for the user, an optional one stays empty.
      answers.splice(answers.indexOf(a), 1)
      const why = `The written answer kept a phrase your rules ban ("${(again?.problems ?? problems).join('", "')}")`
      if (f.required) openQ(f, why)
      else skipped.push({ label: f.label, reason: why })
    }
  }

  // No upload on the page got the CV, but there are plain "Choose a file or drop it here" boxes none of them
  // marked required (SmartRecruiters at SQLI: "Please attach your resume"): the first one is the CV box.
  // Only on a first pass, where the whole page is planned, and when the page has no CV already.
  const cvPlanned = answers.some((x) => x.source === 'resume') || fields.some((f) => f.kind === 'file' && /\.(pdf|docx?)$/i.test(f.value))
  if (!cvPlanned && !ctx.retryKeys?.size && ctx.resumePath) {
    const box = fields.find((f) => f.kind === 'file' && !f.disabled && !answers.some((x) => x.key === f.key) && /^(choose|drop|upload|attach|browse|select|add)\b|drag/i.test(normalizeQuestion(f.label) || 'choose'))
    if (box) {
      answers.push({ key: box.key, label: box.label, kind: box.kind, required: box.required, value: ctx.resumePath.split(/[\\/]/).pop() ?? 'cv', file: ctx.resumePath, source: 'resume' })
      const i = skipped.findIndex((s) => s.label === box.label)
      if (i >= 0) skipped.splice(i, 1)
    }
  }

  return { answers, open, skipped, aiCalls }
}

/** One lite-model call that rewrites written answers without the phrases the user's rules ban. */
async function rewriteWritten(items: RewriteItem[], ctx: PlanContext): Promise<Array<{ key: string; text: string }>> {
  const p = rewriteFormTextPrompt({ profile: ctx.profile, job: ctx.job, items })
  ctx.onAiCall?.()
  const r = await generateJson({ task: 'form_answers', model: 'lite', schema: formAnswersSchema, system: p.system, prompt: p.prompt, temperature: 0.3, maxOutputTokens: 6144 })
  return r.data.answers.filter((x) => typeof x.value === 'string' && x.value.trim()).map((x) => ({ key: x.key, text: x.value as string }))
}

/** Standard details as facts for the AI ("Notice period: 1 month"). */
function factsFrom(ctx: PlanContext): string[] {
  const facts: string[] = []
  for (const e of STANDARD_ENTRIES) {
    const v = ctx.bank.std(e.key)
    if (v) facts.push(`${e.question}: ${v}`)
  }
  return facts
}

async function askAi(fields: ScannedField[], ctx: PlanContext) {
  const toPrompt = (f: ScannedField): FormFieldForPrompt => ({
    key: f.key,
    label: f.label.slice(0, 400),
    kind: f.kind,
    required: f.required,
    ...(f.options.length ? { options: f.options.map((o) => o.label).slice(0, 60) } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}),
    ...(f.section ? { section: f.section } : {}),
    ...(f.error ? { error: f.error } : {}),
  })
  const items: Array<{ key: string; value: string | null; choices: string[] | null; needsHuman: boolean; reason: string | null }> = []
  let calls = 0
  for (let i = 0; i < fields.length; i += 30) {
    const chunk = fields.slice(i, i + 30).map(toPrompt)
    if (ctx.aiAnswer) {
      items.push(...(await ctx.aiAnswer(chunk)))
      calls++
      continue
    }
    const essay = chunk.some((f) => f.kind === 'textarea' || ESSAY_RE.test(f.label))
    const saved = ctx.bank.rows
      .filter((r) => !isStandardKey(r.key) && r.answer)
      .slice(0, 60)
      .map((r) => ({ question: r.question, answer: r.answer as string }))
    const p = formAnswersPrompt({ profile: ctx.profile, job: ctx.job, saved, facts: factsFrom(ctx), fields: chunk })
    ctx.onAiCall?.()
    calls++
    const r = await generateJson({
      task: 'form_answers',
      model: essay && ctx.primaryOk ? 'primary' : 'lite',
      schema: formAnswersSchema,
      system: p.system,
      prompt: p.prompt,
      temperature: 0.3,
      maxOutputTokens: 8192,
    })
    items.push(...r.data.answers)
  }
  return { items, calls }
}
