import type { Page } from 'playwright'
import { generateJson } from '@/lib/ai/gemini'
import { diagnosePrompt, driverPrompt, type ProfileForPrompt } from '@/lib/ai/prompts'
import { driverStepSchema, failureDiagnosisSchema, type DriverStep, type FailureDiagnosis } from '@/lib/ai/schemas'
import { identityFacts, workRightsSentence, type CandidateContext } from '@/lib/candidate/context'
import { loadCandidateContext } from '@/lib/candidate/load'
import type { AnswerBank } from './answer-bank'
import { claimsFalseRight, truthfulWorkAnswer } from './work-rights'
import { hintsFor, keepDiagnosis, keepLesson as saveLesson, lessonsFor } from './lessons'
import { hostOf } from './match'
import { scanPage, settle } from './navigate'
import { EMAIL_VERIFY_URL_RE, alreadyAppliedText, knockoutText } from './knockout'

/**
 * The screenshot form driver. When the rule-based agent gets stuck, the AI looks at a screenshot of the page
 * and reads its accessibility snapshot (every element with a [ref]), names the page template it
 * recognises, picks a few actions, sees the page again, and repeats until the site confirms the
 * application or only the person can go on. What worked per kind of site is kept for the next form there
 * (SiteLesson, see lessons.ts), and so are the fix hints from runs that got stuck (diagnoseStop); every
 * step's screenshot is kept with the attempt.
 */

const MAX_STEPS = 20

/** Removes eager-applicant words that read as generated: "I am very excited to apply" -> "I would like to apply". */
export function toneDown(text: string): string {
  const adv = '(?:very |so |really |truly |extremely )?'
  return text
    .replace(new RegExp(`\\bI(?:'m| am) ${adv}(?:excited|thrilled|eager) to\\b`, 'gi'), 'I would like to')
    .replace(new RegExp(`\\bI(?:'m| am) ${adv}(?:excited|thrilled|eager|passionate) (?:about|by)\\b`, 'gi'), 'I care about')
    .replace(new RegExp(`\\b${adv}(?:excited|thrilled|eager|passionate)\\b`, 'gi'), 'keen')
}
const SNAPSHOT_CHARS = 60_000

/** The kind of application site, for lessons that carry over between companies. */
export function siteKind(url: string): string {
  const h = hostOf(url)
  if (/smartrecruiters/.test(h)) return 'smartrecruiters'
  if (/recruitee/.test(h) || /\/o\/[^/]+\/c\/new/.test(url)) return 'recruitee'
  if (/myworkdayjobs|workday/.test(h)) return 'workday'
  if (/teamtailor/.test(h)) return 'teamtailor'
  if (/oraclecloud/.test(h)) return 'oracle'
  if (/workable/.test(h)) return 'workable'
  for (const k of ['greenhouse', 'lever', 'ashbyhq', 'personio', 'successfactors', 'jobvite', 'bamboohr', 'join.com', 'homerun', 'factorial', 'softgarden', 'jobylon', 'breezy', 'pinpoint', 'eightfold', 'hibob', 'keka', 'rippling', 'gem.com']) if (h.includes(k)) return k
  return h
}

/** A screenshot of the visible part of the page, small enough to send with every step. */
export async function viewportShot(page: Page): Promise<Buffer | null> {
  if (page.isClosed()) return null
  return page.screenshot({ type: 'jpeg', quality: 50, timeout: 8000, animations: 'disabled', caret: 'hide' }).catch(() => null)
}

/**
 * Why the form stopped, read from a screenshot of the page, its snapshot and the last actions: shown to
 * the person with the attempt, and kept per kind of site so the next run knows how to get past it.
 */
export async function diagnoseStop(input: { page: Page; reason: string; job: { title: string; company: string }; history?: string[]; shot?: Buffer | null; candidate?: CandidateContext }): Promise<FailureDiagnosis | null> {
  const { page } = input
  if (page.isClosed()) return null
  const raw = await page.ariaSnapshot({ mode: 'ai', timeout: 15_000 }).catch(() => '')
  const shot = input.shot ?? (await viewportShot(page))
  if (!raw && !shot) return null
  const ctx = input.candidate ?? (await loadCandidateContext())
  const p = diagnosePrompt({ url: page.url(), job: input.job, reason: input.reason, snapshot: trimSnapshot(raw).slice(0, 30_000), history: (input.history ?? []).slice(-12), candidate: ctx })
  try {
    const r = await generateJson({
      task: 'form_diagnose',
      model: 'lite',
      schema: failureDiagnosisSchema,
      system: p.system,
      prompt: p.prompt,
      temperature: 0.2,
      maxOutputTokens: 2048,
      images: shot ? [{ mimeType: 'image/jpeg', data: shot.toString('base64') }] : undefined,
    })
    const d = r.data
    // The diagnosis goes to the attempt whether or not it can be kept.
    await keepDiagnosis({ kind: siteKind(page.url()), url: page.url(), category: d.category, pattern: d.pattern, blocker: d.blocker, fixHint: d.fixHint }, ctx)
    return d
  } catch {
    return null
  }
}

async function keepLesson(kind: string, url: string, lesson: string | null, outcome: string, ctx: CandidateContext): Promise<void> {
  // Only what worked is taught: lessons from runs that gave up taught the model to give up.
  // The email-link note is kept too, since it is a fact about the site, not a guess.
  if (!lesson || (outcome !== 'submitted' && outcome !== 'review' && !/email link/.test(lesson))) return
  await saveLesson({ kind, url, lesson: lesson.slice(0, 300), outcome }, ctx)
}

/** Everything true about the person that a form may ask: identity, right to work, saved answers, jobs. */
export function factsFor(bank: AnswerBank, email: string, ctx: CandidateContext, countryCode: string | null | undefined, profile?: ProfileForPrompt): string[] {
  const facts = identityFacts(ctx)
  if (email && !ctx.email) facts.push(`Email: ${email}`)
  facts.push(`Right to work: ${workRightsSentence(ctx, countryCode)}`)
  for (const r of bank.rows) if (r.key.startsWith('std:') && r.answer) facts.push(`${r.question}: ${r.answer}`)
  for (const e of profile?.experience ?? ctx.experience) facts.push(`Job: "${e.title}" at ${e.company}, ${e.from ?? '?'} to ${e.to ?? 'now'}${e.bullets?.length ? `. ${e.bullets.slice(0, 2).join(' ')}` : ''}`)
  return facts.slice(0, 70)
}

/**
 * The whole page in a size the model reads well: link targets, images and empty wrappers out, the form
 * kept. Cutting the form short made Gemini "scroll down" for 20 steps on Celonis-style long forms.
 */
function trimSnapshot(snap: string): string {
  const lines = snap
    .split('\n')
    .filter((l) => !/^\s*- \/(url|placeholder):/.test(l) && !/^\s*- img\b/.test(l) && !/^\s*- generic \[ref=[^\]]+\](?: \[[^\]]+\])*:?\s*$/.test(l) && !/^\s*- (separator|strong|emphasis)\b/.test(l))
  const start = lines.findIndex((l) => /^\s*- (form|main)\b/.test(l))
  const body = (start > 0 ? lines.slice(start) : lines).join('\n')
  return body.length > SNAPSHOT_CHARS ? `${body.slice(0, SNAPSHOT_CHARS)}\n... (cut)` : body
}

/**
 * The accessible name of each ref, for the safety checks. Refs inside iframes read "f1e868" (Playwright 1.63):
 * matching only "e\d+" left every iframe element nameless, past the Submit/visa/account checks.
 * `near` is the closest text above a nameless element, so the history can say which box Gemini pressed.
 */
export function namesByRef(snap: string): Map<string, { role: string; name: string; near: string }> {
  const out = new Map<string, { role: string; name: string; near: string }>()
  let near = ''
  for (const line of snap.split('\n')) {
    const m = line.match(/- ([\w-]+)(?: "([^"]*)")?[^\n]*\[ref=((?:f\d+)?e\d+)\]/)
    if (m) {
      out.set(m[3], { role: m[1], name: m[2] ?? '', near })
      if (m[2]) near = m[2]
    }
    // Plain text lines ("- text: Choose job location", "- generic [ref=e5]: Location") label what follows.
    const text = line.match(/^\s*- (?:text|paragraph|generic|heading|label|strong)\b[^:]*:\s*"?([^"\n]{2,80})"?\s*$/)
    if (text) near = text[1].trim()
  }
  return out
}

/**
 * Files go in before anything is typed: Workable and Personio re-render the form from the parsed CV and wipe
 * answers filled earlier in the same step. The other actions keep the model's order.
 */
export function uploadsFirst<T extends { type: string }>(acts: T[]): T[] {
  return [...acts.filter((a) => /^upload_/.test(a.type)), ...acts.filter((a) => !/^upload_/.test(a.type))]
}

const SUBMIT_RE = /^(submit|send|apply|enviar|absenden|envoyer|soumettre|bewerben|verzenden|invia|submit application|send application)\b/i
/**
 * Never: clearing the person's CV or files, accounts, sign-ins, newsletters, withdrawing. Deleting a broken work or
 * education entry is fine (SmartRecruiters adds title-less ones from the CV that block the form).
 */
const NEVER_RE = /(delete|remove|clear|borrar|eliminar|quitar|löschen|entfernen|supprimer|verwijderen).{0,40}(files?|archivos?|cv\b|resume|résumé|curr[ií]cul|attachment|document|datei|fichier|application|account|profile)|sign ?up|register|create (an )?account|log ?in|sign ?in|subscribe|withdraw/i
/** An option that claims military service ("I Am A Protected Veteran" at Intermedia): only for someone whose saved answer says so. */
const CLAIMS_VETERAN = /\bi (am|identify as) (an? |one or more of the classifications of )?(protected |active duty |disabled |armed forces service medal )?veteran/i

/** Whether the person's saved diversity answer says they served (veteran claims are refused otherwise). */
export function isVeteran(ctx: Pick<CandidateContext, 'diversity'>): boolean {
  const v = (ctx.diversity.veteran ?? '').trim()
  return !!v && !/^(no|none|not|n\/a|prefer|decline|i am not|i.?m not)\b/i.test(v) && /\b(yes|veteran|served|military)\b/i.test(v)
}

/**
 * Put a file into the upload the model pointed at: the input itself, an input inside it, the file input of
 * the same frame that belongs to it (a hidden input beside an "Attach Resume" button, OX Security's Comeet
 * form, where clicking never opened a file dialog), or the file dialog the click opens.
 */
async function uploadNear(page: Page, loc: ReturnType<Page['locator']>, file: string, purpose: RegExp) {
  const isInput = await loc.evaluate((e) => e.tagName === 'INPUT' && (e as HTMLInputElement).type === 'file').catch(() => false)
  if (isInput) return loc.setInputFiles(file, { timeout: 10_000 })
  const inside = loc.locator('input[type=file]')
  if (await inside.count().catch(() => 0)) return inside.first().setInputFiles(file, { timeout: 10_000 })
  // The nearest file input in the same frame: walk up from the button until a container holds one.
  const marked = await loc
    .evaluate((el, src) => {
      const re = new RegExp(src, 'i')
      let n: Element | null = el
      for (let i = 0; n && i < 8; i++, n = n.parentElement) {
        const inputs = Array.from(n.querySelectorAll('input[type=file]'))
        if (!inputs.length) continue
        const pick = inputs.find((x) => re.test(`${x.getAttribute('name') ?? ''} ${x.id} ${x.closest('[class], div')?.textContent?.slice(0, 200) ?? ''}`)) ?? inputs[0]
        pick.setAttribute('data-jf-upload', '1')
        return true
      }
      const all = Array.from(document.querySelectorAll('input[type=file]'))
      const pick = all.find((x) => re.test(`${x.getAttribute('name') ?? ''} ${x.id}`)) ?? (all.length === 1 ? all[0] : null)
      if (!pick) return false
      pick.setAttribute('data-jf-upload', '1')
      return true
    }, purpose.source)
    .catch(() => false)
  if (marked) {
    const frame = (await loc.elementHandle().catch(() => null))?.ownerFrame ? await (await loc.elementHandle())!.ownerFrame() : null
    const target = (frame ?? page.mainFrame()).locator('input[type=file][data-jf-upload="1"]').first()
    await target.setInputFiles(file, { timeout: 10_000 })
    await target.evaluate((e) => e.removeAttribute('data-jf-upload')).catch(() => undefined)
    return
  }
  // Personio's "Add file" sometimes opens no chooser on the first click: one more try.
  const once = async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 })
    await loc.click({ timeout: 8000 })
    await (await chooser).setFiles(file)
  }
  await once().catch(async () => {
    await page.waitForTimeout(1000)
    await once()
  })
}

/** Tick or untick a box and make sure it stays that way; one click at most, then the DOM itself. */
export async function setChecked(loc: ReturnType<Page['locator']>, want: boolean) {
  const state = () => loc.isChecked({ timeout: 3000 }).catch(() => null)
  if ((await state()) === want) return
  await (want ? loc.check({ timeout: 8000 }) : loc.uncheck({ timeout: 8000 })).catch(async () => {
    if ((await state()) !== want) await loc.click({ timeout: 5000 }).catch(() => undefined)
  })
  if ((await state()) === want) return
  await loc.evaluate((e, v) => {
    const box = e as HTMLInputElement
    box.checked = v
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.dispatchEvent(new Event('change', { bubbles: true }))
  }, want)
}

export interface DriveResult {
  status: 'submitted' | 'review' | 'stuck'
  reason: string
  /** What Gemini did, step by step (for the failure diagnosis). */
  history?: string[]
}

export async function driveWithGemini(input: {
  page: Page
  why: string
  job: { title: string; company: string; countryCode?: string | null }
  bank: AnswerBank
  email: string
  fullName: string
  profile?: ProfileForPrompt
  coverLetter: string | null
  cvPath: string | null
  coverLetterPath: string | null
  mayPressSubmit: boolean
  log: (m: string) => void
  onAiCall?: () => void
  /** A click opened the form in a new tab; the driver now works there. */
  onPage?: (page: Page) => void
  /** Each step's screenshot, to keep with the attempt. */
  onShot?: (shot: Buffer, label: string) => void
  /** Fewer steps for a single instruction typed in the panel (default 20). */
  maxSteps?: number
  /** The site already answered Submit (read from the network): what it said, so Gemini stops there. */
  sentBySite?: () => string | null
}): Promise<DriveResult> {
  const history: string[] = []
  const r = await drive(input, history)
  return { ...r, history }
}

async function drive(input: Parameters<typeof driveWithGemini>[0], history: string[]): Promise<DriveResult> {
  const { log } = input
  let page = input.page
  const kind = siteKind(page.url())
  const ctx = input.profile?.candidate ?? (await loadCandidateContext())
  const cc = input.job.countryCode ?? null
  const [lessons, hints] = await Promise.all([lessonsFor(kind, ctx), hintsFor(kind, ctx)])
  log(lessons.length || hints.length ? `known site pattern "${kind}": ${lessons.length} lesson(s), ${hints.length} fix hint(s)` : `new site pattern "${kind}": Gemini learns it on this form`)
  const facts = factsFor(input.bank, input.email, ctx, cc, input.profile)
  const tries = new Map<string, number>()
  /** Clicks per button name: the same "Apply" pressed again and again goes nowhere (19 times on Jobindex). */
  const clicks = new Map<string, number>()
  let mailto: string | null = null
  let lastLesson: string | null = null

  const maxSteps = input.maxSteps ?? MAX_STEPS
  for (let step = 1; step <= maxSteps; step++) {
    // Recruitee clears its form once the application is in: never fill and send that empty form again.
    const sent = input.sentBySite?.()
    if (sent) return { status: 'submitted', reason: sent }
    if (page.isClosed()) return { status: 'stuck', reason: 'The tab was closed' }
    // A knockout gate after a truthful answer greys out the whole form: stop, the attempt closes it as not eligible.
    const ko = await knockoutText(page).catch(() => null)
    if (ko) return { status: 'stuck', reason: `Not eligible: ${ko}` }
    const raw = await page.ariaSnapshot({ mode: 'ai', timeout: 20_000 }).catch(() => '')
    if (!raw) return { status: 'stuck', reason: 'Could not read the page' }
    const names = namesByRef(raw)
    // Look first: the screenshot shows the template, the step, pop-ups and red errors the snapshot hides.
    const shot = await viewportShot(page)
    if (shot) input.onShot?.(shot, `gemini-step-${step}`)
    const p = driverPrompt({ job: input.job, url: page.url(), why: input.why, snapshot: trimSnapshot(raw), history: history.slice(-14), facts, candidate: ctx, coverLetter: input.coverLetter, lessons, hints, mayPressSubmit: input.mayPressSubmit, hasScreenshot: !!shot })
    input.onAiCall?.()
    let r: DriverStep
    try {
      r = (
        await generateJson({
          task: 'form_fix',
          model: 'lite',
          schema: driverStepSchema,
          system: p.system,
          prompt: p.prompt,
          temperature: 0.2,
          maxOutputTokens: 4096,
          images: shot ? [{ mimeType: 'image/jpeg', data: shot.toString('base64') }] : undefined,
        })
      ).data
    } catch (err) {
      return { status: 'stuck', reason: `Gemini did not answer (${err instanceof Error ? err.message.slice(0, 120) : err})` }
    }
    lastLesson = r.lesson ?? lastLesson
    log(`gemini step ${step} [${r.pattern.slice(0, 80)}]: ${r.thought}`)

    const stepPage = page
    for (const a of uploadsFirst(r.actions)) {
      // The refs of this step belong to the old tab; the next step reads the new one.
      if (page !== stepPage) break
      const el = a.ref ? names.get(a.ref) : undefined
      const name = el?.name ?? ''
      const shown = name || (el?.near ? `unnamed ${el.role} near "${el.near.slice(0, 40)}"` : '')
      const desc = `${a.type}${a.ref ? ` ${a.ref} "${shown.slice(0, 70)}"` : ''}${a.value ? ` = "${a.value.slice(0, 50)}"` : ''}`
      // Safety: no account, password, clearing files or a visa answer that is not the person's true one.
      if (NEVER_RE.test(name) || el?.role === 'textbox' && /password/i.test(name)) {
        history.push(`${desc}: refused (not allowed)`)
        continue
      }
      // A model once ticked "I Am A Protected Veteran" for someone who never served (Intermedia).
      if ((a.type === 'fill' || a.type === 'select' || a.type === 'click' || a.type === 'check') && !isVeteran(ctx) && CLAIMS_VETERAN.test(`${name} ${a.value ?? ''}`)) {
        history.push(`${desc}: refused (the saved answers do not say veteran; choose "I am not a protected veteran" or "I choose not to identify")`)
        continue
      }
      if ((a.type === 'fill' || a.type === 'select' || a.type === 'click') && (!truthfulWorkAnswer(name, a.value ?? name, ctx, cc) || claimsFalseRight(`${name} ${a.value ?? ''}`, ctx, cc))) {
        history.push(`${desc}: refused (not the true right-to-work answer: ${workRightsSentence(ctx, cc).slice(0, 160)})`)
        continue
      }
      if (a.type === 'click' && SUBMIT_RE.test(name.trim()) && !input.mayPressSubmit) {
        history.push(`${desc}: refused (Submit is for review mode)`)
        continue
      }
      const loc = a.ref ? page.locator(`aria-ref=${a.ref}`) : null
      try {
        switch (a.type) {
          case 'fill':
            // Banned words never reach an employer, even when the model writes them (Devoteam, LUZA).
            if (a.value) a.value = toneDown(a.value)
            await loc!.fill(a.value ?? '', { timeout: 8000 }).catch(async () => {
              await loc!.click({ timeout: 5000 })
              await page.keyboard.press('ControlOrMeta+a')
              await page.keyboard.type(a.value ?? '', { delay: 20 })
            })
            break
          case 'click': {
            // An "Apply" that is an email link opens the mail app (Outlook popped up 19 times on Jobindex).
            const href = await loc!.getAttribute('href', { timeout: 2000 }).catch(() => null)
            if (href && /^mailto:/i.test(href)) {
              mailto = href.slice(7).split('?')[0]
              history.push(`${desc}: not clicked, it is an email link (${mailto})`)
              break
            }
            // Multi-page forms press "Next" / "Save and continue" on every page: those are progress, not a loop.
            if (!/next|continue|weiter|suivant|siguiente|save|review|zurück|back/i.test(name)) {
              // Per element: several "Select" menus (HiBob) or one "I know it" per skill (solid.jobs) share a name.
              const key = `${shown}\u0000${a.ref ?? ''}`
              clicks.set(key, (clicks.get(key) ?? 0) + 1)
            }
            // A custom dropdown (nofluffjobs' multiselect, Ashby's "Start typing...") opens on the first click and
            // closes on the next: Gemini pressed the same box 4 times on 23 forms.
            if (!name || el?.role === 'combobox') {
              history.push(`${desc}: this is a dropdown/box, not a button - after this click pick an option from the opened list ([role=option] / listbox items) or type into it and press Enter; do not click the box again`)
            }
            // "Apply on company website" opens the form in a new tab: work there, or the same button gets
            // pressed again and again on the old page, one new tab each time (Rumli, 5 tabs).
            const popup = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null)
            await loc!.click({ timeout: 8000 }).catch(() => loc!.evaluate((e) => (e as HTMLElement).click()))
            const opened = await popup
            if (opened && !opened.isClosed()) {
              await opened.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
              history.push(`${desc}: opened a new tab (${opened.url().slice(0, 100)}); now working there`)
              page = opened
              input.onPage?.(opened)
            }
            break
          }
          case 'select':
            await loc!.selectOption({ label: a.value ?? '' }, { timeout: 8000 }).catch(() => loc!.selectOption(a.value ?? '', { timeout: 5000 }))
            break
          case 'check':
          case 'uncheck':
            // Read the box before and after: check() can toggle it and still throw, and a blind click
            // then unticks it again (Teamtailor consent with a hidden twin input).
            await setChecked(loc!, a.type === 'check')
            break
          case 'upload_cv':
          case 'upload_cover_letter': {
            const file = a.type === 'upload_cv' ? input.cvPath : input.coverLetterPath
            if (!file) throw new Error('no file for it')
            await uploadNear(page, loc!, file, a.type === 'upload_cv' ? /resume|cv|curr[ií]cul|lebenslauf/i : /cover|motivation|letter|anschreiben/i)
            break
          }
          case 'press':
            await page.keyboard.press(a.value || 'Enter')
            break
          case 'wait':
            await page.waitForTimeout(Math.min(Number(a.value) || 1500, 5000))
            break
        }
        history.push(`${desc}: ok`)
      } catch (err) {
        history.push(`${desc}: failed (${err instanceof Error ? err.message.split('\n')[0].slice(0, 100) : err})`)
      }
      await page.waitForTimeout(250)
    }
    await settle(page, 800).catch(() => undefined)
    if (mailto) {
      void keepLesson(kind, page.url(), `On this site "Apply" is an email link (${mailto}): the job takes applications by email, not a form.`, 'needs_human', ctx)
      return { status: 'stuck', reason: `The job asks for applications by email (${mailto}), not a web form` }
    }
    const looped = [...clicks.entries()].find(([, n]) => n >= 4)
    if (looped) {
      void keepLesson(kind, page.url(), lastLesson, 'gave_up', ctx)
      return { status: 'stuck', reason: `Gemini pressed "${looped[0].split('\u0000')[0].slice(0, 60)}" ${looped[1]} times and the page did not move on` }
    }

    // The site's own word counts, not the model's: a confirmation page or "already applied".
    const { scan } = await scanPage(page).catch(() => ({ scan: null }))
    // A "confirm your email" page is not a submission: nothing is sent until the person clicks the mailed link.
    if (EMAIL_VERIFY_URL_RE.test(page.url())) return { status: 'stuck', reason: 'Not finished yet: the site emailed a confirmation link. Click it in the email to complete this application.' }
    const done = scan?.successText || /\/(applied|success|thank|confirmation|completed)/i.test(page.url())
    if (done) {
      void keepLesson(kind, page.url(), lastLesson, 'submitted', ctx)
      return { status: 'submitted', reason: scan?.successText ?? page.url() }
    }
    // "You have already applied to this position" (Eightfold answers Submit with it): the application is in.
    const already = await alreadyAppliedText(page).catch(() => null)
    if (already) return { status: 'submitted', reason: `Already applied: ${already}` }
    if (r.status === 'submitted' && !input.mayPressSubmit) {
      void keepLesson(kind, page.url(), lastLesson, 'review', ctx)
      return { status: 'review', reason: r.reason }
    }
    if (r.status === 'needs_human') {
      void keepLesson(kind, page.url(), lastLesson, 'needs_human', ctx)
      return { status: 'stuck', reason: r.reason }
    }
    // The same fields again and again (Workable's nationality list snapping back to Afghanistan) burn
    // the quota: hint once, then hand over. Steps that only click Next/Continue are not counted.
    const fields = r.actions.filter((a) => a.type === 'fill' || a.type === 'select' || a.type === 'check' || a.type === 'uncheck')
    const sig = [...new Set(fields.map((a) => (a.ref ? names.get(a.ref)?.name : '') ?? ''))].sort().join('|')
    if (sig) {
      const seen = (tries.get(sig) ?? 0) + 1
      tries.set(sig, seen)
      if (seen >= 3) {
        void keepLesson(kind, page.url(), lastLesson, 'gave_up', ctx)
        return { status: 'stuck', reason: `Gemini tried the same fields ${seen} times and the page did not keep them: ${r.thought.slice(0, 150)}` }
      }
      if (seen === 2) history.push(`NOTE: you already tried ${sig.slice(0, 80)} and it did not stick. Do it another way: open the list and click the option by its own ref (not ArrowDown+Enter), or type fewer letters; if it still will not take it, answer needs_human.`)
    }
  }
  void keepLesson(kind, page.url(), lastLesson, 'gave_up', ctx)
  return { status: 'stuck', reason: `Gemini worked ${MAX_STEPS} steps without finishing the form` }
}
