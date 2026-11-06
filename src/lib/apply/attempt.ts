import fs from 'node:fs'
import path from 'node:path'
import type { BrowserContext, Frame, Locator, Page } from 'playwright'
import type { Prisma } from '@/generated/prisma/client'
import { NoKeyAvailableError } from '@/lib/ai/key-pool'
import { formExperiment } from '@/lib/analytics/experiment'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { agentsBrowserConfig, BrowserUnavailableError, connectApplyBrowser, findTab, tabIdOf, type BrowserConfig } from '@/lib/browser/chrome'
import { db } from '@/lib/db'
import { notify, resolveNeedsYou } from '@/lib/notifications'
import { describeConflict, findCooldownConflict } from '@/lib/pipeline/cooldown'
import { draftApplication, toJobForPrompt, writeCoverLetter } from '@/lib/pipeline/draft'
import { modestSalaryAsk } from '@/lib/pipeline/quality-gate'
import { getBannedPhrases } from '@/lib/pipeline/humanize/phrases'
import { getProfileForPrompt } from '@/lib/pipeline/profile'
import { loadCandidateContext } from '@/lib/candidate/load'
import type { AppSettings } from '@/lib/settings/schema'
import { getSettings } from '@/lib/settings/service'
import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'
import { findEmployerLink, NO_FORM_HOSTS, NON_EUROPE_BOARDS } from '@/lib/sources/freehire'
import { loadAnswerBank, recordOpenQuestion } from './answer-bank'
import { waitForEmailCode, waitForEmailLink } from './email-codes'
import { diagnoseStop, driveWithGemini, viewportShot, type DriveResult } from './driver'
import { worthASecondLook } from './fixer'
import { applyPlan, fileKept, hiddenContexts, inFrontOf, loadChoiceOptions, withKeyboard } from './fill'
import { asksNotToSubmit, converse, followInstruction, listenForAsks, stopListening } from './ask'
import { chatInPage } from './panel-chat'
import { runInFrame } from './inpage'
import { asksAiToIdentify, bannerInPage, canHandOver, capKeptTabs, earlierTabOpen, isDeadPosting, rememberKeptTab } from './handover'
import { coverLetterPdfPath, cvForTitle, photoFilePath, screenshotPath } from './files'
import { hostOf, normalizeQuestion } from './match'
import { acceptTermsDialog, captchaAnswered, clickAndFollow, dismissCookies, findApplicationForm, isBlockedHost, isLoginPage, looksLikeApplicationForm, relevantFields, scanPage, settle } from './navigate'
import { planAnswers, type PlanContext } from './plan'
import { coverLetterStep, isEmailedCodeField, worthAsking } from './standard'
import type { AttemptMode, AttemptStatus, OpenQuestion, PageScan, PlannedAnswer, ScannedButton, ScannedField, StepLog } from './types'
import { formTarget, siteFor, type FormTarget } from './urls'
import { countryNameVariants, escapeRegex } from '@/lib/geo'
import { countryName, EU_COUNTRY_CODES } from '@/lib/domain'
import { isWorkdayUrl, workdaySignIn, WorkdayLoginError, workdayStatusUrl } from './workday'
import { adapterFor, alwaysCaptcha, laneFor, triageKey, vendorFormUrl } from './adapters'
import { customQuestionCount, fetchGreenhouseQuestions, greenhouseRef, prefetchedKnockout } from './adapters/greenhouse'
import { rememberCompanyBoard } from './company-board'
import { recordHostOutcome } from './hosts'
import { isNameNotResolved, networkUp } from './network'
import { turnstilePending, waitForTurnstile } from './turnstile'
import { ALREADY_APPLIED_RE, EMAIL_VERIFY_URL_RE, KNOCKOUT_RE, alreadyAppliedText, knockoutText } from './knockout'
import { describeSignal, watchSubmits, type SubmitSignal } from './submit-signal'

/** Playwright's error when the tab is gone (closed by you, or lost by the extension). */
const TAB_CLOSED_RE = /Target page, context or browser has been closed/

const submitVerdictSchema = z.object({
  submitted: z.boolean(),
  evidence: z.string().default(''),
  blocker: z.enum(['none', 'captcha', 'missing_field', 'validation', 'still_loading', 'other']).default('other'),
  detail: z.string().default(''),
})
type SubmitVerdict = z.infer<typeof submitVerdictSchema>

/** European country names as option labels read them, to recognise a country list. */
const EUROPE_NAMES = new Set(EU_COUNTRY_CODES.map((c) => normalizeQuestion(countryName(c))))

/**
 * One run of the browser agent for one application (see plan-browser-apply.md):
 * open the form, fill every page, check and repair, then stop for your review (mode "fill")
 * or submit and confirm (mode "submit"). Tabs that need you stay open in the apply browser.
 */

const MAX_PAGES = 12
const ATTEMPT_BUDGET_MS = 14 * 60_000
/** How long a form you opened yourself waits for your CAPTCHA or sign-in before it hands the tab over. */
const YOUR_TURN_MINUTES = 10

/** The first of these elements that is on screen (each may be in a different frame). */
async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) if (await c.isVisible().catch(() => false)) return c
  return null
}
const COVER_RE = /cover|motivation|anschreiben/i
/** Optional "other documents" uploads: the cover letter goes there (Deploja's "Övriga dokument"). */
const OTHER_DOCS_RE = /other|additional|further|supporting|övriga|weitere|autres|overige|more (documents|files)/i

type AttemptRow = Prisma.PortalAttemptGetPayload<{
  include: { application: { include: { job: { include: { score: true; company: true; sourceLinks: { select: { source: true; externalId: true; url: true } } } } } } }
}>

/** Ends the run with a final status (not an error). */
export class AttemptStop extends Error {
  constructor(
    public status: AttemptStatus,
    public reason: string,
    public code?: 'quota' | 'browser' | 'cooldown' | 'cancelled' | 'site',
  ) {
    super(reason)
    this.name = 'AttemptStop'
  }
}

export interface AttemptOutcome {
  status: AttemptStatus
  reason?: string
  code?: AttemptStop['code']
}

const json = (v: unknown) => v as Prisma.InputJsonValue

class AttemptRunner {
  private steps: StepLog[] = []
  private shots: string[] = []
  private aiCalls = 0
  /** The posting flags AI-written applications: no AI answers, no AI cover letter. */
  private aiTrap = false
  private page: Page | null = null
  private keepTab = false
  private context: BrowserContext | null = null
  /**
   * Tabs this attempt opened itself, plus pop-ups opened from them ("Apply" in a new tab). Only these
   * are closed at the end: the person's own tabs and the Claude agents' tabs in the same Chrome are never touched
   * (closing "every new tab" once closed the user's Signifly CAPTCHA tab and the agents' forms).
   */
  private ownPages = new Set<Page>()
  private alreadyApplied = false
  /** The site's answer to a Submit (the person's own press in the tab too), read from the network. */
  private sent: SubmitSignal | null = null
  /** Form posts on their way right now, and when the last one left: the site is still sending. */
  private sending = 0
  private lastSendAt = 0
  private unwatchSubmits: Array<() => void> = []
  private stopWatchingTabs: (() => void) | null = null
  private planned: PlannedAnswer[] = []
  private open: OpenQuestion[] = []
  private started = Date.now()
  private ctx!: PlanContext
  private target!: FormTarget
  private captchaNotified = false
  /** Minutes a form may take: shorter on systems the agent knows (plan-apply-all.md 7.1). */
  private budgetMs = ATTEMPT_BUDGET_MS
  /** The form's address once found, for the host triage table. */
  private formUrl: string | null = null
  /** A page was opened, so the outcome says something about the website. */
  private opened = false
  /** Cloudflare Turnstile under the form: filled first, it often passes by itself in a normal Chrome. */
  private turnstileDeferred = false
  /** A CAPTCHA on the form: everything is filled first, and the user solves it right before Submit. */
  private captchaDeferred = false
  /** What Gemini did on this form, step by step, for the failure diagnosis. */
  private driveHistory: string[] = []
  /** Gemini step screenshots kept with this attempt (capped: the disk is small). */
  private stepShots = 0
  /** The time budget already grew once for your CAPTCHA or sign-in. */
  private waitedForYou = false
  /** The AI waits for your CAPTCHA or sign-in right now, so it can act on what you type in the panel. */
  private waitingForYou = false
  /** What you typed in the panel while the AI was busy filling: done at the next pause, and before Submit. */
  private notes: string[] = []
  /** Everything you typed in the panel on this form. */
  private instructions: string[] = []
  private askBusy = false

  /** The panel's "Do it" on a form you opened with AI (window.__jfAsk). */
  private onAsk = async (text: string): Promise<string> => {
    if (this.askBusy) return 'Still working on your last request; one moment.'
    if (!this.page || this.page.isClosed()) return 'The tab is closed.'
    // A chat: questions get answers right away; what the user asks to be done holds for the rest of this form
    // (Gemini's later steps and Submit included). While the AI fills, it is done at the next pause.
    return converse(this.page, text, {
      applicationId: this.app.id,
      log: (m) => this.log(m),
      onAiCall: () => {
        this.aiCalls++
      },
      actNow: this.waitingForYou,
      act: (instruction) => {
        this.instructions.push(instruction)
        return this.followNow(instruction)
      },
      queue: (instruction) => {
        this.instructions.push(instruction)
        this.notes.push(instruction)
      },
    })
  }

  private async followNow(text: string): Promise<string> {
    if (!this.page || this.page.isClosed()) return 'The tab is closed.'
    this.askBusy = true
    try {
      // "Use the cover letter there": the letter must exist as a file before the AI can upload it.
      if (/cover|motivation|anschreiben|letter/i.test(text)) await this.ensureCoverLetter(true).catch(() => undefined)
      return await followInstruction(this.page, text, {
        applicationId: this.app.id,
        log: (m) => this.log(m),
        onAiCall: () => {
          this.aiCalls++
        },
        files: { cvPath: this.ctx.resumePath, coverLetterPath: this.ctx.coverLetterPath },
        earlier: this.instructions,
      })
    } finally {
      this.askBusy = false
    }
  }

  /** What you said on this form, for Gemini's own steps: "The person told you on this form: ...". */
  private standingOrders(): string {
    return this.instructions.length ? ` The person told you on this form: ${this.instructions.map((t) => `"${t}"`).join('; ')}. Keep to that.` : ''
  }

  /** At a pause in the filling (before Next or Submit): your notes are done now, and new ones right away. */
  private async followNotes() {
    if (!this.notes.length) return
    this.waitingForYou = true
    try {
      await this.runNotes()
    } finally {
      this.waitingForYou = false
    }
  }

  /** Carry out what you typed while the AI was busy. */
  private async runNotes() {
    while (this.notes.length) {
      const text = this.notes.shift()!
      if (this.page && !this.page.isClosed()) await runInFrame(this.page.mainFrame(), chatInPage, { thinking: `Working on: ${text.slice(0, 100)}` }).catch(() => undefined)
      const r = await this.followNow(text)
      this.log(`your note "${text.slice(0, 80)}": ${r.slice(0, 160)}`)
      // The chat said "I'll do it at the next pause": now it says what was done.
      if (this.page && !this.page.isClosed()) await runInFrame(this.page.mainFrame(), chatInPage, { add: { role: 'ai', text: r }, thinking: null }).catch(() => undefined)
    }
  }

  constructor(
    private attempt: AttemptRow,
    private settings: AppSettings & { portal: BrowserConfig },
    private interactive: boolean,
  ) {}

  private get app() {
    return this.attempt.application
  }
  private get job() {
    return this.attempt.application.job
  }
  private get mode(): AttemptMode {
    return this.attempt.mode === 'submit' ? 'submit' : 'fill'
  }

  log(message: string, level: StepLog['level'] = 'info') {
    this.steps.push({ at: new Date().toISOString(), level, message })
    console.log(`[apply ${this.attempt.id.slice(-6)}] ${message}`)
  }

  private async save(data: Prisma.PortalAttemptUpdateInput = {}) {
    await db.portalAttempt
      .update({
        where: { id: this.attempt.id },
        data: { steps: json(this.steps), screenshots: this.shots, aiCalls: this.aiCalls, fields: json(this.publicAnswers()), questions: json(this.open), ...data },
      })
      .catch(() => undefined)
  }

  /** Answers as shown in the UI (file paths reduced to names). */
  private publicAnswers() {
    return this.planned.map((a) => ({ key: a.key, label: a.label, kind: a.kind, value: a.value, choices: a.choices, checked: a.checked, source: a.source, required: a.required, file: a.file ? path.basename(a.file) : undefined }))
  }

  private async checkpoint() {
    // You pressed Send yourself and the site took it: stop before the AI fills the cleared form again.
    if (this.sent && this.sent.outcome !== 'rejected') throw new AttemptStop('NEEDS_HUMAN', `The site answered Submit: ${describeSignal(this.sent)}`)
    const row = await db.portalAttempt.findUnique({ where: { id: this.attempt.id }, select: { status: true } })
    if (row?.status === 'CANCELLED') throw new AttemptStop('CANCELLED', 'Stopped by you', 'cancelled')
    if (Date.now() - this.started > this.budgetMs) throw new AttemptStop('NEEDS_HUMAN', 'Took too long; the form is open in the apply browser for you to finish')
    await this.save()
  }

  private async shot(label: string) {
    if (!this.settings.portal.screenshots || !this.page || this.page.isClosed()) return
    const p = screenshotPath(this.attempt.id, this.shots.length + 1, label)
    fs.mkdirSync(path.dirname(p.abs), { recursive: true })
    try {
      await this.page.screenshot({ path: p.abs, fullPage: true, type: 'jpeg', quality: 55, timeout: 25_000 })
      this.shots.push(p.rel)
    } catch (err) {
      this.log(`screenshot failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`, 'warn')
    }
  }

  /** A screenshot Gemini looked at, kept with the attempt so the person can see each step (at most 8 per attempt). */
  private keepStepShot(shot: Buffer, label: string) {
    if (!this.settings.portal.screenshots || this.stepShots >= 8) return
    this.stepShots++
    const p = screenshotPath(this.attempt.id, this.shots.length + 1, label)
    try {
      fs.mkdirSync(path.dirname(p.abs), { recursive: true })
      fs.writeFileSync(p.abs, shot)
      this.shots.push(p.rel)
    } catch {
      // A missing step picture is not worth failing the attempt over.
    }
  }

  // ---------------------------------------------------------------- setup

  private async precheck() {
    const { portal, email } = this.settings
    if (!portal.enabled) throw new AttemptStop('FAILED', 'Browser apply is turned off in Settings → Browser', 'site')
    // An earlier email application does not count: employers often answer "apply through our site".
    if (this.app.sentAt && (this.app.submittedVia || this.app.portalStatus === 'SUBMITTED')) throw new AttemptStop('CANCELLED', 'Already applied to this job through its website')
    if (['QUEUED', 'APPROVED'].includes(this.app.status)) throw new AttemptStop('CANCELLED', 'An email application for this job is queued; not applying twice')
    if (this.job.company.blacklisted) throw new AttemptStop('CANCELLED', 'The company is blacklisted')
    this.target = formTarget(this.job, this.job.sourceLinks)
    // Adzuna, Jooble, Jobicy, Himalayas: no form there. The employer's own posting, when freehire.me knows it.
    if (NO_FORM_HOSTS.test(hostOf(this.target.url))) {
      const link = await findEmployerLink(this.job.companyName, this.job.title)
      if (link) {
        this.log(`using the employer's own posting instead of ${hostOf(this.target.url)}: ${link}`)
        await db.job.update({ where: { id: this.job.id }, data: { url: link } })
        this.target = formTarget({ url: link, atsType: null }, [])
      } else {
        // They answered "apply on our careers page": start there. Adzuna shows "not available in your
        // region" to the agents' browser (8 such runs were once cancelled).
        const told = await db.emailMessage.findFirst({ where: { applicationId: this.app.id, classification: 'APPLY_VIA_PORTAL' }, orderBy: { receivedAt: 'desc' }, select: { classificationMeta: true } })
        const raw = (told?.classificationMeta as { applyUrl?: string | null } | null)?.applyUrl?.trim()
        const careers = raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : null
        if (careers) {
          this.log(`using the careers page they pointed to instead of ${hostOf(this.target.url)}: ${careers}`)
          this.target = formTarget({ url: careers, atsType: null }, [])
        }
      }
    }
    if (isBlockedHost(this.target.url, this.settings.portal.linkedinEasyApply)) throw new AttemptStop('CANCELLED', `${hostOf(this.target.url)} does not allow automated applications; apply there by hand in the apply browser`, 'site')
    // A form on a board outside Europe (JobStreet Philippines, Seek, Naukri) belongs to a job outside Europe.
    if (NON_EUROPE_BOARDS.test(hostOf(this.target.url))) {
      await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
      throw new AttemptStop('CANCELLED', `${hostOf(this.target.url)} is a job board outside Europe; this is not a European job`)
    }
    if (!portal.sites.includes(this.target.site)) throw new AttemptStop('CANCELLED', `Applying on ${this.target.site === 'other' ? 'company career sites' : this.target.site} is turned off in Settings → Browser`, 'site')
    if (this.mode === 'submit' && !this.app.cooldownOverride) {
      const c = await findCooldownConflict({ companyId: this.job.companyId, countryCode: this.job.countryCode, excludeApplicationId: this.app.id, toEmail: null }, email)
      if (c) throw new AttemptStop('CANCELLED', describeConflict(this.job.companyName, this.job.countryCode, c, email), 'cooldown')
    }
    // A known application system: straight to its form, a shorter budget, and its CAPTCHA habits.
    const direct = vendorFormUrl(this.target.url)
    if (direct && direct !== this.target.url) {
      this.log(`going straight to the form: ${direct}`)
      this.target = { ...this.target, url: direct }
    }
    const vendor = adapterFor(this.target.url)
    if (vendor && !this.interactive) this.budgetMs = vendor.budgetMinutes * 60_000
    // BambooHR and JazzHR put an "I'm not a robot" box on every form: no run gets past it alone, so the job
    // goes straight to your CAPTCHA list instead of spending a try and a tab (34 tries, 0 submitted).
    if (vendor && !this.interactive && alwaysCaptcha(this.target.url)) {
      throw new AttemptStop('NEEDS_HUMAN', `A CAPTCHA needs a person: ${vendor.label} shows an "I am not a robot" box on every form.`)
    }
  }

  /**
   * Greenhouse lists every job's questions publicly: read them before the page opens, and stop at once
   * when a required "where do you live" list leaves out the person's country (no answer would be true).
   */
  private async prefetchQuestions() {
    if (adapterFor(this.target.url)?.id !== 'greenhouse' && this.target.ats !== 'greenhouse') return
    const ref = greenhouseRef(this.target.url, this.job.sourceLinks, this.job.company.atsType === 'greenhouse' ? this.job.company.atsSlug : null)
    if (!ref) return
    const questions = await fetchGreenhouseQuestions(ref)
    if (!questions) return
    this.log(`Greenhouse lists ${questions.length} question(s), ${customQuestionCount(questions)} beyond the contact details`)
    const ko = prefetchedKnockout(questions, this.ctx.bank.std('country') || this.ctx.candidate?.countryName)
    if (ko) {
      await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
      throw new AttemptStop('CANCELLED', ko)
    }
  }

  private async prepare() {
    const profile = await getProfileForPrompt()
    const bank = await loadAnswerBank()
    const usage = await getAiUsageSummary().catch(() => null)
    const cached = await this.cachedAnswers()
    const candidate = profile.candidate ?? (await loadCandidateContext())
    this.ctx = {
      bank,
      email: (await db.candidateProfile.findUnique({ where: { id: 1 }, select: { email: true } }))?.email ?? '',
      fullName: profile.fullName,
      yearsExperience: profile.yearsExperience,
      coverLetter: this.app.coverLetter,
      resumePath: await this.pickCv(),
      coverLetterPath: null,
      photoPath: photoFilePath(),
      coverLetterEverywhere: false,
      salaryAsk: modestSalaryAsk(this.job, candidate),
      candidate,
      jobCountryCode: this.job.countryCode,
      profile,
      job: toJobForPrompt(this.job),
      company: this.job.companyName,
      useAi: true,
      primaryOk: (usage?.primaryRemaining ?? 0) >= 2,
      cached,
      onAiCall: () => {
        this.aiCalls++
      },
    }
    if (!this.ctx.email) throw new AttemptStop('FAILED', 'Your email address is missing in Settings → Profile')
  }

  /** The CV for this title (a frontend, full-stack or backend version when Settings → Browser says so). */
  private async pickCv(): Promise<string> {
    const cv = await cvForTitle(this.job.title, this.settings.portal.cvVariants === true)
    if (cv.variant !== 'main') this.log(`uploading the ${cv.variant} version of the CV`)
    await db.application.update({ where: { id: this.app.id }, data: { cvVariant: cv.variant } }).catch(() => undefined)
    return cv.path
  }

  /** Answers given on an earlier attempt for this application, reused without AI. */
  private async cachedAnswers(): Promise<Map<string, PlannedAnswer>> {
    const prev = await db.portalAttempt.findFirst({
      where: { applicationId: this.app.id, id: { not: this.attempt.id }, status: { in: ['AWAITING_REVIEW', 'NEEDS_HUMAN', 'FAILED'] }, fields: { not: undefined } },
      orderBy: { startedAt: 'desc' },
      select: { fields: true },
    })
    const map = new Map<string, PlannedAnswer>()
    const rows = Array.isArray(prev?.fields) ? (prev!.fields as unknown as PlannedAnswer[]) : []
    for (const r of rows) if (r.kind !== 'file' && r.label && r.source !== 'resume') map.set(normalizeQuestion(r.label), r)
    return map
  }

  private async ensureCoverLetter(needFile: boolean) {
    if (!this.settings.portal.coverLetter) return
    if (!this.ctx.coverLetter) {
      this.log('writing a cover letter for this job')
      const job = await db.job.findUniqueOrThrow({ where: { id: this.job.id }, include: { score: true } })
      const letter = await writeCoverLetter(job, this.ctx.profile, this.settings, await getBannedPhrases(), this.ctx.primaryOk ? 'primary' : 'lite')
      this.aiCalls++
      await db.application.update({ where: { id: this.app.id }, data: { coverLetter: letter.coverLetter, answers: json(letter.answers) } })
      this.ctx.coverLetter = letter.coverLetter
    }
    if (needFile && !this.ctx.coverLetterPath && this.ctx.coverLetter) {
      this.ctx.coverLetterPath = await coverLetterPdfPath(this.app.id, this.ctx.coverLetter, this.ctx.fullName, this.job.companyName)
    }
  }

  // ---------------------------------------------------------------- flow

  async run(): Promise<AttemptOutcome> {
    const outcome = await this.runInner()
    await this.recordTriage(outcome)
    return outcome
  }

  /**
   * The attempt's host and lane on its row, and the outcome on the host's triage record (once per
   * attempt). Runs stopped before any page opened (cooldown, already applied, settings) teach nothing.
   */
  private async recordTriage(outcome: AttemptOutcome) {
    const url = this.formUrl ?? this.target?.url ?? null
    const host = url ? triageKey(url) : null
    const lane = laneFor(this.target?.url ?? url, { batch: !!this.attempt.batchId })
    await db.portalAttempt.update({ where: { id: this.attempt.id }, data: { host, lane } }).catch(() => undefined)
    if (!this.opened || !host) return
    if (outcome.code === 'cooldown' || outcome.code === 'cancelled' || outcome.code === 'quota') return
    // A job the person does not qualify for, or one applied to before, says nothing about the website.
    if (/^(not eligible|already applied)/i.test(outcome.reason ?? '')) return
    await recordHostOutcome(host, outcome.status as Parameters<typeof recordHostOutcome>[1], outcome.reason ?? null, {
      atsType: adapterFor(url)?.id ?? this.target?.ats ?? null,
      skipAfterFails: this.settings.portal.skipHostAfterFails,
    })
  }

  /**
   * Open the start page. A name that does not resolve is either the network (every name fails: the
   * batch waits, and the try does not count) or a dead site (asked twice, 30 s apart: the job is skipped).
   */
  private async openTarget(page: Page, url: string) {
    this.opened = true
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        return
      } catch (err) {
        const message = err instanceof Error ? (err.message.split(/\r?\n/)[0] ?? '') : String(err)
        if (!isNameNotResolved(message)) throw err
        if (!(await networkUp())) throw new AttemptStop('FAILED', `Network down: no internet or DNS while opening ${hostOf(url)} (${message.slice(0, 80)}); the batch waits and tries again`, 'browser')
        if (attempt >= 1) {
          await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
          throw new AttemptStop('CANCELLED', `Site does not resolve: ${hostOf(url)} has no address (asked twice, 30 s apart); the posting's site is gone`)
        }
        this.log(`${hostOf(url)} did not resolve; asking again in 30 s`, 'warn')
        await page.waitForTimeout(30_000)
      }
    }
  }

  private async runInner(): Promise<AttemptOutcome> {
    await db.portalAttempt.update({ where: { id: this.attempt.id }, data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null, needsHumanReason: null } })
    await db.application.update({ where: { id: this.app.id }, data: { portalStatus: 'RUNNING', lastActivityAt: new Date() } })
    try {
      await this.precheck()
      await this.prepare()
      await this.prefetchQuestions()
      const { context } = await connectApplyBrowser(this.settings.portal)
      if (this.settings.portal.headless) hiddenContexts.add(context)
      // Tabs this attempt opens (the posting, an "Apply" pop-up) are closed at the end, except the one kept for you.
      this.context = context
      const onNewTab = (p: Page) => {
        void p
          .opener()
          .then((o) => {
            if (o && this.ownPages.has(o)) this.track(p)
          })
          .catch(() => undefined)
      }
      context.on('page', onNewTab)
      this.stopWatchingTabs = () => context.off('page', onNewTab)
      if (this.mode === 'submit') {
        const reviewed = await db.portalAttempt.findFirst({
          where: { applicationId: this.app.id, id: { not: this.attempt.id }, status: 'AWAITING_REVIEW', tabId: { not: null } },
          orderBy: { startedAt: 'desc' },
        })
        const tab = await findTab(context, reviewed?.tabId)
        if (tab && reviewed) {
          this.log('continuing in the tab you reviewed')
          this.opened = true
          this.page = tab
          this.track(tab)
          // Show the reviewed answers on this run too (the form already holds them).
          if (Array.isArray(reviewed.fields)) this.planned = reviewed.fields as unknown as PlannedAnswer[]
          await tab.bringToFront().catch(() => undefined)
          await db.portalAttempt.update({ where: { id: reviewed.id }, data: { tabId: null } })
        }
      }
      if (!this.page) {
        // A tab an earlier try left for you stays open with its answers: if this try fails, this tab goes
        // and that one stays (one tab per application, the first one).
        this.page = await context.newPage()
        this.track(this.page)
        await blockMailtoLinks(this.page)
        this.log(`opening ${this.target.url}`)
        await this.openTarget(this.page, this.target.url)
        await settle(this.page, 1200)
      }
      await this.save({ startUrl: this.target.url, atsType: this.target.ats })

      if (this.target.site === 'linkedin') {
        // Applied before (by you, or on another run): LinkedIn shows it on the posting.
        const shown = await this.page.evaluate(() => document.querySelector('main')?.textContent?.slice(0, 4000) ?? '').catch(() => '')
        if (/\bApplied\s+\d+\s*(minute|hour|day|week|month)s?\s+ago\b|Application submitted/i.test(shown)) {
          await db.job.update({ where: { id: this.job.id }, data: { status: 'APPLIED' } }).catch(() => undefined)
          throw new AttemptStop('CANCELLED', 'You already applied to this job on LinkedIn')
        }
        if (/No longer accepting applications/i.test(shown)) {
          await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
          throw new AttemptStop('CANCELLED', 'LinkedIn: no longer accepting applications')
        }
      }

      const navOpts = {
        log: (m: string) => this.log(m),
        job: { title: this.job.title, company: this.job.companyName },
        useAi: true,
        allowLinkedIn: this.settings.portal.linkedinEasyApply,
        onAiCall: () => {
          this.aiCalls++
        },
      }
      let found = await findApplicationForm(this.page, navOpts)
      // A board page with no way on (EURES, aggregators, "external website"): the employer's own
      // posting, when freehire.me knows it, before a person has to look.
      if (found.status === 'notfound' && !isDeadPosting(found.reason) && !NO_FORM_HOSTS.test(hostOf(this.target.url))) {
        const link = await findEmployerLink(this.job.companyName, this.job.title).catch(() => null)
        if (link && hostOf(link) !== hostOf(found.page.url())) {
          this.log(`no way on from ${hostOf(found.page.url())}; trying the employer's own posting: ${link}`)
          await found.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
          await settle(found.page, 1200)
          found = await findApplicationForm(found.page, navOpts)
        }
      }
      this.page = found.page
      if (found.status === 'email') {
        await this.switchToEmail(found.email)
        throw new AttemptStop('CANCELLED', `Applications go by email to ${found.email}: an email is drafted for your approval (nothing is sent without you)`)
      }
      if (found.status === 'blocked') throw new AttemptStop('CANCELLED', found.reason, 'site')
      if (found.status === 'closed') {
        // Take the job out of the queue, or the next batch tick picks the same closed posting again.
        await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
        throw new AttemptStop('CANCELLED', found.reason)
      }
      if (found.status === 'notfound') {
        // "Page not found", "not available in your region"...: the posting is gone, not a job for you.
        if (isDeadPosting(found.reason)) {
          await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
          throw new AttemptStop('CANCELLED', found.reason)
        }
        // A careers page whose form the navigator could not find (OX Security's embedded Comeet form): Gemini
        // reads the page, presses Apply and fills it, the same way it finishes stuck forms.
        if (this.settings.portal.secondLook && this.ctx.useAi && !this.aiTrap && !NO_FORM_HOSTS.test(hostOf(found.page.url()))) {
          this.page = found.page
          const r = await this.geminiDrive(found.reason)
          if (r.status === 'submitted') {
            await this.markSubmitted(`Gemini found and finished the form: ${r.reason.slice(0, 200)}`)
            return { status: 'SUBMITTED' }
          }
          if (r.status === 'review') throw new AttemptStop('AWAITING_REVIEW', 'Gemini filled the form; review it and press Submit.')
          throw new AttemptStop('NEEDS_HUMAN', `${found.reason}. Gemini tried and stopped: ${r.reason.slice(0, 300)}`)
        }
        throw new AttemptStop('NEEDS_HUMAN', `${found.reason}. Open the tab in the apply browser to apply by hand.`)
      }
      if (found.status === 'login') await this.signIn()
      if (found.status === 'captcha') {
        // Turnstile passes by itself in a normal Chrome, often while the form is being filled (Personio).
        if (found.scan.captcha?.kind === 'turnstile') {
          this.turnstileDeferred = true
          this.log('Cloudflare Turnstile under the form; filling first, it often passes by itself')
        } else if (looksLikeApplicationForm(found.scan)) {
          // A CAPTCHA on the form itself comes last: everything is filled first, the person only solves it.
          this.captchaDeferred = true
          this.log('CAPTCHA on the form; filling everything first, the CAPTCHA comes last')
        } else await this.handleCaptcha()
      }
      await this.noteFormSystem()
      const pageText = await this.page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      if (asksAiToIdentify(`${this.job.description ?? ''}\n${pageText}`)) {
        // Facts from your saved answers still go in; anything the AI would write is left for you.
        this.aiTrap = true
        this.ctx.useAi = false
        for (const [k, a] of this.ctx.cached ?? []) if (a.source === 'ai') this.ctx.cached!.delete(k)
        this.log('this posting has instructions for AI assistants (the company flags AI-written applications); the AI writes no answers here', 'warn')
      }
      this.formUrl = this.page.url()
      await this.save({ formUrl: this.formUrl })
      await this.formLoopWithSecondLook()
      return { status: 'SUBMITTED' }
    } catch (err) {
      return await this.fail(err)
    } finally {
      await this.cleanupTab()
    }
  }

  /**
   * A company careers page whose form is really Greenhouse, Lever, Ashby or Workday (Stripe, Databricks,
   * Elastic, Datadog, Coinbase): from here on it is handled as that system, and the company's board is
   * noted so its other jobs come from the board feed.
   */
  private async noteFormSystem() {
    const page = this.page!
    const urls = [page.url(), ...page.frames().map((f) => f.url())]
    const vendorUrl = urls.find((u) => adapterFor(u))
    const vendor = vendorUrl ? adapterFor(vendorUrl) : null
    if (vendor && this.target.site === 'other' && vendor.id !== 'linkedin') {
      this.log(`the form is on ${vendor.label} behind ${hostOf(this.target.url)}`)
      this.target = { ...this.target, ats: vendor.id, site: siteFor(vendor.id) }
      if (!this.interactive) this.budgetMs = Math.max(vendor.budgetMinutes * 60_000, Date.now() - this.started + 4 * 60_000)
      await this.save({ atsType: vendor.id })
    }
    await rememberCompanyBoard(this.job.companyId, urls, (m) => this.log(m)).catch(() => undefined)
  }

  /** Sign-in walls: Workday accounts are handled by the agent; other sites need you once. */
  /** The step-by-step panel on the form while the AI waits for you (only in your Chrome, when you started it). */
  private async yourTurn(steps: string[], status: string, title = 'Job Pilot: your turn') {
    if (!this.page || this.page.isClosed()) return
    // Waiting for you does not count against the form's time budget.
    if (status.startsWith('Waiting') && !this.waitedForYou) {
      this.waitedForYou = true
      this.budgetMs += YOUR_TURN_MINUTES * 60_000
    }
    await runInFrame(this.page.mainFrame(), bannerInPage, { title, steps, status }).catch(() => undefined)
  }

  /** On a form you opened with AI the panel stays up while it fills, so you can tell it what to do. */
  private async showFilling() {
    if (!this.interactive) return
    await this.yourTurn(
      ['Nothing to do yet: the AI fills this form.', 'Want something done differently? Type it below and press Do it: the AI does it before it submits.'],
      'The AI is filling the form',
      'Job Pilot',
    )
  }

  /**
   * Many sites land on your profile or a dashboard after a sign-in ("Sign in with Google" included), not
   * on the job: go back to the job and find its form again, in the same tab, so the AI carries on there.
   */
  private async backToFormAfterSignIn(page: Page) {
    const { scan } = await scanPage(page).catch(() => ({ scan: null }))
    if (!scan || looksLikeApplicationForm(scan)) return
    const back = this.formUrl ?? this.target.url
    this.log(`back to the job after your sign-in: ${back}`)
    await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
    await settle(page, 1500)
    const again = (await scanPage(page).catch(() => ({ scan: null }))).scan
    if (!again || looksLikeApplicationForm(again)) return
    const found = await findApplicationForm(page, {
      log: (m: string) => this.log(m),
      job: { title: this.job.title, company: this.job.companyName },
      useAi: true,
      allowLinkedIn: this.settings.portal.linkedinEasyApply,
      onAiCall: () => {
        this.aiCalls++
      },
    }).catch(() => null)
    // The form opened in another tab: bring it into this one, which the form loop keeps working in.
    if (found && found.page !== page && !found.page.isClosed()) {
      const url = found.page.url()
      await found.page.close().catch(() => undefined)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
      await settle(page, 1200)
    }
  }

  private async signIn() {
    const page = this.page!
    if (!isWorkdayUrl(page.url())) {
      // You opened it yourself: sign in here and the AI carries on (it never types passwords).
      if (this.interactive) {
        await page.bringToFront().catch(() => undefined)
        await this.yourTurn(
          [`Sign in to ${hostOf(page.url())} in this tab, or create the account: the AI never types passwords.`, 'Once you are in, leave it: the AI goes on with the application and submits by itself.'],
          `Waiting for you, up to ${YOUR_TURN_MINUTES} minutes`,
        )
        this.log(`waiting for you to sign in on ${hostOf(page.url())}`)
        const deadline = Date.now() + YOUR_TURN_MINUTES * 60_000
        this.waitingForYou = true
        await this.runNotes()
        while (Date.now() < deadline) {
          await page.waitForTimeout(4000)
          if (this.askBusy) continue
          if (page.isClosed()) throw new AttemptStop('NEEDS_HUMAN', 'The tab was closed while waiting for your sign-in')
          const { scan } = await scanPage(page).catch(() => ({ scan: null }))
          if (scan && !isLoginPage(scan)) {
            this.waitingForYou = false
            this.log('signed in by you, continuing')
            await this.yourTurn(['Thanks: the AI continues from here.'], 'The AI is filling the form')
            await settle(page, 1200)
            await this.backToFormAfterSignIn(page)
            return
          }
        }
        this.waitingForYou = false
        throw new AttemptStop('NEEDS_HUMAN', `${hostOf(page.url())} asks you to sign in; nobody signed in within ${YOUR_TURN_MINUTES} minutes.`)
      }
      throw new AttemptStop('NEEDS_HUMAN', `${hostOf(page.url())} asks you to sign in. Log in once in the apply browser (the login is saved), then press Retry.`)
    }
    try {
      await workdaySignIn(page, this.ctx.email, (m) => this.log(m))
    } catch (err) {
      if (err instanceof WorkdayLoginError) throw new AttemptStop('NEEDS_HUMAN', err.message)
      throw err
    }
    await settle(page, 1200)
  }

  private pickButton(scan: PageScan, kind: ScannedButton['kind']): ScannedButton | undefined {
    const list = scan.buttons.filter((b) => b.kind === kind && b.visible && !b.disabled)
    if (kind === 'submit') return list.find((b) => /application|bewerbung|candidature/i.test(b.text)) ?? list[0]
    return list[0]
  }

  /**
   * When the form loop gets stuck on the form itself, a second AI look at the screenshot tries a few small
   * steps (a pop-up's Agree, a format fix, a missed option) and the loop runs once more.
   */
  private async formLoopWithSecondLook() {
    for (let round = 0; ; round++) {
      try {
        await this.formLoop()
        return
      } catch (err) {
        const page = this.page
        if (!(err instanceof AttemptStop) || err.status !== 'NEEDS_HUMAN' || round >= 1 || !this.settings.portal.secondLook) throw err
        if (this.aiTrap || !this.ctx.useAi || !page || page.isClosed() || !worthASecondLook(err.reason)) throw err
        // After Submit the page may only now say "You already applied for this job": the press went through.
        const text = /pressed submit/i.test(err.reason) ? await page.evaluate(() => document.body?.innerText ?? '').catch(() => '') : ''
        if (/you (have )?already applied|already (been )?submitted|application (has )?already been (received|submitted)/i.test(text)) {
          await this.markSubmitted('Already applied: the site says so after Submit')
          return
        }
        // Gemini takes over the way a person would: read the page, act, read it again, until the site confirms.
        this.log(`stuck ("${err.reason.slice(0, 80)}"); Gemini takes over the form`)
        const r = await this.geminiDrive(err.reason)
        if (r.status === 'submitted') {
          await this.markSubmitted(`Gemini finished the form: ${r.reason.slice(0, 200)}`)
          return
        }
        if (r.status === 'review') throw new AttemptStop('AWAITING_REVIEW', 'Gemini filled the form; review it and press Submit.')
        throw new AttemptStop('NEEDS_HUMAN', `${err.reason.slice(0, 300)} Gemini tried and stopped: ${r.reason.slice(0, 300)}`)
      }
    }
  }

  /** The screenshot driver reads the page and acts until the site confirms the application or only the person can go on. */
  private async geminiDrive(why: string): Promise<DriveResult> {
    this.log(`Gemini takes over (${why.slice(0, 80)})`)
    const r = await driveWithGemini({
      page: this.page!,
      why: `${why}${this.standingOrders()}`,
      job: { title: this.job.title, company: this.job.companyName, countryCode: this.job.countryCode },
      bank: this.ctx.bank,
      email: this.ctx.email,
      fullName: this.ctx.fullName,
      profile: this.ctx.profile,
      coverLetter: this.ctx.coverLetter,
      cvPath: this.ctx.resumePath,
      coverLetterPath: this.ctx.coverLetterPath,
      mayPressSubmit: this.mode === 'submit' && !this.instructions.some(asksNotToSubmit),
      log: (m) => this.log(m),
      onAiCall: () => {
        this.aiCalls++
      },
      onPage: (p) => {
        this.track(p)
        this.page = p
      },
      onShot: (shot, label) => this.keepStepShot(shot, label),
      sentBySite: () => (this.sent && this.sent.outcome !== 'rejected' ? describeSignal(this.sent) : null),
    }).catch((e): DriveResult => ({ status: 'stuck', reason: `Gemini stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}` }))
    this.driveHistory.push(...(r.history ?? []))
    await this.shot(`gemini-${r.status}`)
    return r
  }

  private async formLoop() {
    const page = this.page!
    let reopened = false
    let waitedForLoad = false
    let lastSignature = ''
    let samePage = 0
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      await this.checkpoint()
      await dismissCookies(page)
      await acceptTermsDialog(page)
      await this.showFilling()
      await this.followNotes()
      let { scan, frames } = await scanPage(page)
      if (scan.captcha?.challengeVisible && scan.captcha.kind === 'turnstile') {
        // Checked again right before Submit, when it has had time to pass by itself.
        this.turnstileDeferred = true
      } else if (scan.captcha?.challengeVisible && looksLikeApplicationForm(scan)) {
        // On the form itself: fill everything first, the CAPTCHA is the last thing before Submit.
        if (!this.captchaDeferred) this.log('CAPTCHA on this page; filling everything first, the CAPTCHA comes last')
        this.captchaDeferred = true
      } else if (scan.captcha?.challengeVisible) {
        await this.handleCaptcha()
        ;({ scan, frames } = await scanPage(page))
      }
      if (isLoginPage(scan)) {
        await this.signIn()
        ;({ scan, frames } = await scanPage(page))
      }
      if (!looksLikeApplicationForm(scan) && pageNo > 1 && scan.successText) throw new AttemptStop('NEEDS_HUMAN', 'The site says the application is done, but the agent did not press Submit; please check the tab')
      const seen = relevantFields(scan).filter((f) => f.visible || f.kind === 'file')
      // Kinds and labels in the log show which questions a site's widgets hide from the scanner.
      this.log(`page ${pageNo}: ${seen.length} fields${this.target.site === 'linkedin' ? ` (${seen.map((f) => `${f.kind}: ${f.label.slice(0, 40)}`).join('; ')})` : ''}`)
      // "Next" that leaves the same questions on screen (LinkedIn Easy Apply, pressed 12 times): something
      // on the page blocks it. Stop after two repeats and say what the site complains about.
      const signature = `${page.url().split('#')[0]}|${seen.map((f) => `${f.kind}:${f.label}`).join('|')}`
      samePage = signature === lastSignature ? samePage + 1 : 0
      lastSignature = signature
      if (samePage >= 2) {
        await this.shot(`page-${pageNo}-not-moving`)
        const complaints = [...scan.errors, ...this.problems(scan).map((p) => p.error || `"${p.label.slice(0, 60)}" is empty`)].slice(0, 4)
        throw new AttemptStop('NEEDS_HUMAN', `"Next" does not move past this page${complaints.length ? `; the site says: ${complaints.join('; ')}` : ''}. Everything else is filled; please finish it in the tab.`)
      }
      if (pageNo === 1 && !relevantFields(scan).some((f) => f.kind === 'file')) {
        // A closed posting often redirects to the careers home, whose only form is "sign up for job alerts" (Toast).
        const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
        if (/talent (community|network|pool)|stay connected|job alerts?|sign up for (job )?(alerts|updates)|join our (talent|newsletter)|industry insights|subscribe to (our )?newsletter/i.test(text) && !/(submit|send) (your |my )?application|apply for this (job|role|position)|upload (your )?(cv|resume)/i.test(text)) {
          await this.shot('alert-signup')
          await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
          throw new AttemptStop('CANCELLED', 'The link leads to a job-alert / talent-community sign-up, not an application form; the posting is probably closed')
        }
      }
      await this.fillPage(scan, frames)
      // Ticking the terms box opens the terms pop-up on Oracle sites: agree before looking for Next.
      if (await acceptTermsDialog(page)) this.log('agreed to the terms pop-up')
      // What you typed in the panel while it filled this page is done before it moves on.
      await this.followNotes()
      ;({ scan, frames } = await scanPage(page))
      const submit = this.pickButton(scan, 'submit')
      const next = this.pickButton(scan, 'next')
      if (submit) {
        await this.shot(`page-${pageNo}-filled`)
        if (this.mode === 'fill') throw new AttemptStop('AWAITING_REVIEW', 'Filled and stopped before Submit. Review the answers and the screenshot, then press Submit.')
        await this.submitAndConfirm(submit)
        return
      }
      if (next) {
        await this.shot(`page-${pageNo}`)
        this.log(`"${next.text}"`)
        await inFrontOf(page, () => clickAndFollow(page, frames, next))
        await settle(page, 900)
        continue
      }
      // An empty page with a spinner (startup.jobs) or a progress bar under a Back arrow (Oracle after
      // the email step): the form is still loading. Look again once.
      if (!seen.length && !scan.buttons.some((b) => b.visible && b.kind !== 'other') && !waitedForLoad) {
        waitedForLoad = true
        this.log('the page is still loading; waiting for the form')
        await settle(page, 6000)
        continue
      }
      // "Check your email, we've sent you a secure login link" (JOIN): signing in through it makes an
      // account there, which is yours to decide.
      const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      if (/check your (e-?mail|inbox)|sent you an? (secure |magic )?(login|log-in|sign.?in|access) link/i.test(bodyText)) {
        await this.shot(`page-${pageNo}-email-link`)
        throw new AttemptStop('NEEDS_HUMAN', `${hostOf(page.url())} emailed you a sign-in link to continue (it creates an account there). Open it from Gmail in this browser to finish, or skip the job.`)
      }
      // Nothing to press: the form may sit behind an "Apply" tab (Dyflexis) — open it once and fill again.
      const opener = reopened ? undefined : scan.buttons.find((b) => b.kind === 'apply' && b.visible && !b.disabled)
      if (opener) {
        reopened = true
        this.log(`no Submit yet; opening the form with "${opener.text}"`)
        await inFrontOf(page, () => clickAndFollow(page, frames, opener))
        await settle(page, 1200)
        continue
      }
      // A greyed-out Submit while a CV is still uploading (Workable shows a half-filled bar): give it time.
      if (scan.buttons.some((b) => b.kind === 'submit' && b.visible && b.disabled)) {
        for (let wait = 0; wait < 10; wait++) {
          await page.waitForTimeout(3000)
          ;({ scan, frames } = await scanPage(page))
          const ready = this.pickButton(scan, 'submit')
          if (ready) {
            await this.shot(`page-${pageNo}-filled`)
            if (this.mode === 'fill') throw new AttemptStop('AWAITING_REVIEW', 'Filled and stopped before Submit. Review the answers and the screenshot, then press Submit.')
            await this.submitAndConfirm(ready)
            return
          }
        }
      }
      await this.shot(`page-${pageNo}-stuck`)
      // A Submit that stays greyed out until a required box or upload is done (HYPE: "Employment reference").
      const greyed = scan.buttons.find((b) => b.kind === 'submit' && b.visible && b.disabled)
      if (greyed) {
        const missing = relevantFields(scan).filter((f) => (f.visible || f.kind === 'file') && f.required && !f.value.trim())
        const files = missing.filter((f) => f.kind === 'file').map((f) => `"${f.label.replace(/^upload\s+/i, '').slice(0, 50)}"`)
        const others = missing.filter((f) => f.kind !== 'file').map((f) => `"${f.label.slice(0, 50)}"`)
        throw new AttemptStop(
          'NEEDS_HUMAN',
          missing.length
            ? `"${greyed.text}" stays disabled until these are done: ${[...files.map((x) => `${x} (a file only you have)`), ...others].join(', ')}. Everything else is filled; add it and submit.`
            : `"${greyed.text}" stays disabled although every required field looks filled; please check the tab and submit.`,
        )
      }
      throw new AttemptStop('NEEDS_HUMAN', 'Could not find a Next or Submit button on this page')
    }
    throw new AttemptStop('NEEDS_HUMAN', 'The form has more pages than expected; please finish it in the apply browser')
  }

  /** Read dropdown options, plan answers, fill, check, and repair once. */
  /**
   * In your own Chrome the agent's tab can sit behind the one you are using. Chrome pauses
   * background tabs, so every click waited 8 s and failed (Alan): put the tab in front first.
   */
  private async inFront() {
    const page = this.page
    if (page && !hiddenContexts.has(page.context())) await page.bringToFront().catch(() => undefined)
  }

  private async fillPage(scan: PageScan, frames: Frame[]) {
    await this.inFront()
    let fields = relevantFields(scan)
    // A step that is only about the cover letter names its unnamed upload box (JOIN put the CV there).
    const coverStep = coverLetterStep(scan)
    if (coverStep) for (const f of fields) if (f.kind === 'file' && !/resume|\bcv\b|curriculum|lebenslauf/i.test(f.label)) f.section = coverStep
    // LinkedIn lists the CVs you uploaded before and has one picked: keep it rather than upload another copy.
    const cvPicked = fields.some((f) => f.kind === 'radio' && f.value && /\.(pdf|docx?)$/i.test(f.value))
    if (cvPicked) fields = fields.filter((f) => !(f.kind === 'file' && /resume|\bcv\b|lebenslauf/i.test(`${f.label} ${f.name}`)))
    for (const f of fields) {
      if ((f.kind === 'combobox' || f.kind === 'listbox') && f.visible && !f.disabled && !f.value && f.options.length === 0 && (f.required || worthAsking(f))) {
        const labels = await loadChoiceOptions(frames[f.frame ?? 0], f, `f${f.frame ?? 0}o`)
        f.options = labels.map((label) => ({ label }))
        // A list that opens without typing is a fixed list, whatever its label says.
        if (labels.length) f.asyncOptions = false
      }
    }
    const coverFields = fields.filter(
      (f) => (COVER_RE.test(`${f.label} ${f.name} ${f.id}`) && (f.kind === 'file' || f.kind === 'textarea')) || (f.kind === 'file' && (OTHER_DOCS_RE.test(`${f.label} ${f.section}`) || (!!coverStep && f.section === coverStep))),
    )
    if (coverFields.length && !this.aiTrap) await this.ensureCoverLetter(coverFields.some((f) => f.kind === 'file'))

    await this.planAndFill(fields, frames)
    await this.page!.waitForTimeout(800)

    let again = await scanPage(this.page!)
    let problems = this.problems(again.scan)
    // Answers can reveal more questions ("Are you still studying?" No → "Graduation year"): a few rounds,
    // as long as each one gets somewhere.
    for (let round = 0; problems.length && round < 3; round++) {
      const before = problems.map((p) => p.label).join('|')
      this.log(`checking ${problems.length} field(s) again: ${problems.map((p) => p.label.slice(0, 40)).join('; ')}`)
      await this.planAndFill(problems, again.frames, new Set(problems.map((p) => p.key)))
      await this.page!.waitForTimeout(800)
      again = await scanPage(this.page!)
      problems = this.problems(again.scan)
      if (problems.map((p) => p.label).join('|') === before) break
    }
    if (problems.length) {
      await this.shot('could-not-fill')
      // "Choose Password / Retype Password": applying here creates an account, which is yours to decide.
      if (problems.some((p) => p.kind === 'password' || /password|passwort|mot de passe|contraseña/i.test(p.label))) {
        throw new AttemptStop('NEEDS_HUMAN', `${hostOf(this.page!.url())} creates an account as part of applying (it asks you to choose a password). Everything else is filled; set a password in the tab if you want an account there, or skip the job.`)
      }
      throw new AttemptStop('NEEDS_HUMAN', `Could not fill: ${problems.map((p) => `"${p.label.slice(0, 60)}"${p.error ? ` (${p.error.slice(0, 80)})` : ''}`).join(', ')}`)
    }
    // A CV upload can vanish when later answers re-render the form (Ashby): check it is still there.
    for (const f of relevantFields(again.scan).filter((x) => x.kind === 'file' && x.required)) {
      const a = this.planned.find((p) => p.file && p.label === f.label)
      if (a && !(await fileKept(again.frames[f.frame ?? 0], f, a, `f${f.frame ?? 0}o`).catch(() => true))) {
        await this.shot('could-not-fill')
        throw new AttemptStop('NEEDS_HUMAN', `Could not fill: "${f.label.slice(0, 60)}" (the site did not keep the file)`)
      }
    }
  }

  private async planAndFill(fields: ScannedField[], frames: Frame[], retryKeys?: Set<string>) {
    let plan
    try {
      plan = await planAnswers(fields, { ...this.ctx, retryKeys })
    } catch (err) {
      if (err instanceof NoKeyAvailableError) throw new AttemptStop('FAILED', 'AI quota is used up for today; the form will be tried again later', 'quota')
      throw err
    }
    for (const s of plan.skipped) if (s.reason !== 'optional') this.log(`left "${s.label.slice(0, 60)}" empty (${s.reason})`)
    // Keep every known answer, also when an open question stops the run: the handover refills them for you.
    for (const a of plan.answers) {
      const i = this.planned.findIndex((p) => p.key === a.key)
      if (i >= 0) this.planned[i] = a
      else this.planned.push(a)
    }
    const requiredOpen = plan.open.filter((q) => q.required)
    // A required home-country list without the person's country (Sofitechsolutions: the Americas, Switzerland, Spain):
    // the employer only hires there, and no answer would be true.
    const home = this.ctx.bank.std('country') || this.ctx.candidate?.countryName || null
    // In any form language: the German name of the country (Tchibo, German SuccessFactors) counts too.
    const homeNames = home ? countryNameVariants(home).map((n) => normalizeQuestion(n)) : []
    const offersHome = (opts: string[]) => !!home && opts.some((o) => homeNames.some((n) => normalizeQuestion(o).includes(n)))
    // "Make My Profile Visible to" (Vodafone) lists countries but asks no home question.
    const notACountryQuestion = (q: OpenQuestion) => /visib|visible|share|privacy|recruiters? (in|from)/i.test(q.label)
    // "Location:" with only European countries and no "Other" (Get Your Tech Talent) asks the same thing.
    const europeOnlyLocation = (q: OpenQuestion) =>
      /^(your |current )?(location|country|country of residence|residence)\b|where (are you|do you) (live|based|located|reside)/.test(normalizeQuestion(q.label)) &&
      q.options.length >= 8 &&
      q.options.filter((o) => EUROPE_NAMES.has(normalizeQuestion(o))).length >= q.options.length * 0.6 &&
      !q.options.some((o) => /\b(other|outside|rest of|international|non.?eu|worldwide|anywhere)\b/i.test(o))
    const notEligible = home ? requiredOpen.find((q) => q.options.length >= 3 && !notACountryQuestion(q) && !offersHome(q.options) && (q.stdKey === 'std:country' || europeOnlyLocation(q))) : undefined
    if (notEligible) {
      await db.job.update({ where: { id: this.job.id }, data: { status: 'SKIPPED' } }).catch(() => undefined)
      throw new AttemptStop('CANCELLED', `Not eligible: "${notEligible.label.slice(0, 60)}" only offers ${notEligible.options.slice(0, 4).join(', ')}${notEligible.options.length > 4 ? '…' : ''}`)
    }
    // A text CAPTCHA box ("CAPTCHA", "type the characters you see") is no question for the answer bank, and
    // the agent never solves one: fill the rest and hand it over like any CAPTCHA.
    const captchaBox = requiredOpen.find((q) => /captcha|security (code|check)|type the (characters|letters|text|code)|characters (you see|shown|in the image)/i.test(q.label))
    if (captchaBox) {
      if (!this.settings.portal.headless) await applyPlan(frames, fields, plan.answers, (m) => this.log(m, 'warn')).catch(() => undefined)
      await this.shot('captcha')
      throw new AttemptStop('NEEDS_HUMAN', 'A CAPTCHA needs a person. Everything else is filled; type the CAPTCHA in the tab and press Submit.')
    }
    if (requiredOpen.length) {
      // In a tab you can see, fill what is known first so only the open question is left for you.
      if (!this.settings.portal.headless) await applyPlan(frames, fields, plan.answers, (m) => this.log(m, 'warn')).catch(() => undefined)
      this.open.push(...requiredOpen)
      for (const q of this.aiTrap ? [] : requiredOpen) {
        if (q.stdKey) {
          // One of your standard details (notice period, salary...): it shows up as waiting in the answer bank.
          await db.answerBank.updateMany({ where: { key: q.stdKey }, data: { timesSeen: { increment: 1 }, lastSeenAt: new Date(), lastCompany: this.job.companyName } }).catch(() => undefined)
        } else {
          await recordOpenQuestion(q.label, q.kind, q.options, this.job.companyName).catch(() => undefined)
        }
      }
      await this.shot('questions')
      if (this.aiTrap) throw new AttemptStop('NEEDS_HUMAN', `This company flags AI-written applications (the posting has instructions for AI assistants), so the AI wrote nothing. Your details are filled in; please write these answers yourself: ${requiredOpen.map((q) => `"${q.label.slice(0, 80)}"`).join(', ')}`)
      throw new AttemptStop('NEEDS_HUMAN', `Needs your answer:${requiredOpen.map((q) => `"${q.label.slice(0, 80)}"`).join(', ')}. Answer it in Settings → Browser → Answers (it is reused on every form), then press Retry.`)
    }
    const r = await applyPlan(frames, fields, plan.answers, (m) => this.log(m, 'warn'))
    this.log(`filled ${r.filled} field(s)${r.failed.length ? `, ${r.failed.length} did not stick` : ''}`)
  }

  /** Required fields still empty, or fields the site marks as wrong. */
  private problems(scan: PageScan): ScannedField[] {
    return relevantFields(scan).filter((f) => {
      if (!f.visible || f.disabled) return false
      // The emailed code is entered after Submit, from Gmail.
      if (isEmailedCodeField(f)) return false
      // Greenhouse keeps "This field is required." until the next submit, even once the field has a value.
      const stale = /\b(required|can'?t be blank|cannot be blank)\b/i.test(f.error ?? '') && (f.kind === 'checkbox' ? f.value === 'true' : f.value.trim() !== '')
      if (f.error && !stale) return true
      if (!f.required) return false
      if (f.kind === 'file') return false // uploads show up in different ways; the site's own error covers it
      if (f.kind === 'checkbox') return f.value !== 'true' && /agree|consent|accept|acknowledge|certify|confirm|terms|privacy/i.test(f.label)
      return f.value.trim() === ''
    })
  }

  /** A CAPTCHA only a person can solve. `formFilled`: it was left for last and everything else is in. */
  private async handleCaptcha(formFilled = false) {
    if (!this.interactive || this.settings.portal.captchaWaitMinutes === 0) {
      await this.shot('captcha')
      throw new AttemptStop('NEEDS_HUMAN', formFilled ? 'A CAPTCHA needs a person; everything else on the form is filled. Open it with AI, solve the CAPTCHA and the AI submits.' : 'A CAPTCHA needs a person. Solve it in the apply browser and finish there, or press Retry after solving it.')
    }
    const page = this.page!
    await page.bringToFront().catch(() => undefined)
    // You opened this one yourself, so you are there: up to 10 minutes, with the steps on the page.
    const minutes = Math.max(this.settings.portal.captchaWaitMinutes, YOUR_TURN_MINUTES)
    await this.yourTurn(
      formFilled
        ? ['The AI filled the whole form.', 'Solve the CAPTCHA (the AI never solves them).', 'Then leave it: the AI presses Submit by itself.']
        : ['Solve the CAPTCHA on this page (the AI never solves them).', 'Then leave it: the AI fills the form and submits by itself.'],
      `Waiting for you, up to ${minutes} minutes`,
    )
    if (!this.captchaNotified) {
      this.captchaNotified = true
      this.log('waiting for you to solve the CAPTCHA in the apply browser')
      await notify('review_needed', `Solve a CAPTCHA: ${this.job.title} at ${this.job.companyName}`, `The form is open in your Chrome and waits for you (up to ${minutes} min).`, `/applications/${this.app.id}`)
    }
    const deadline = Date.now() + minutes * 60_000
    this.waitingForYou = true
    await this.runNotes()
    let clear = 0
    while (Date.now() < deadline) {
      await page.waitForTimeout(4000)
      if (this.askBusy) continue
      // Solved, and the site sent the form by itself (or you pressed Send): the caller records it.
      if (this.sent && this.sent.outcome !== 'rejected') {
        this.waitingForYou = false
        return
      }
      const { scan } = await scanPage(page)
      // A ticked "I'm not a robot" box stays on the page: its answer token says it is solved. Without a token,
      // the challenge must stay away for two looks: hCaptcha hides between its rounds, and a click then
      // closes it unsolved (AnywhereNow's Send spun for good).
      const answered = await captchaAnswered(page)
      if (!answered && scan.captcha?.challengeVisible) clear = 0
      else if (answered || ++clear >= 2) {
        this.waitingForYou = false
        this.log('CAPTCHA solved, continuing')
        await this.yourTurn(['Thanks: the AI continues from here.'], formFilled ? 'The AI is submitting' : 'The AI is filling the form')
        return
      }
    }
    this.waitingForYou = false
    throw new AttemptStop('NEEDS_HUMAN', 'The CAPTCHA was not solved in time. Solve it in the apply browser, then press Retry.')
  }

  /** Turnstile still unanswered at Submit: give it 20 s to pass by itself, then it is a CAPTCHA for you. */
  private async settleTurnstile() {
    const page = this.page!
    // The CAPTCHA left for last: the form is filled, now it is your turn (or the stop, in a batch).
    if (this.captchaDeferred) {
      const { scan } = await scanPage(page)
      if (scan.captcha?.challengeVisible && scan.captcha.kind !== 'turnstile' && !(await captchaAnswered(page))) await this.handleCaptcha(true)
    }
    if (!(await turnstilePending(page))) return
    this.log('waiting for Cloudflare Turnstile to pass by itself')
    if (await waitForTurnstile(page, 20_000)) {
      this.log('Turnstile passed by itself')
      return
    }
    await this.handleCaptcha()
  }

  /** The site's own answer decides: sent (or applied before) is recorded, a company limit closes the job. */
  private async settleBySignal(): Promise<boolean> {
    const s = this.sent
    if (!s || s.outcome === 'rejected') return false
    if (s.outcome === 'company_limit') throw new AttemptStop('CANCELLED', `Not sent: ${describeSignal(s)}`)
    await this.shot('submitted')
    await this.markSubmitted(s.outcome === 'already' ? `Already applied: ${describeSignal(s)}` : describeSignal(s))
    return true
  }

  /**
   * After a CAPTCHA, or a press with no visible reaction, the site may still be sending: Recruitee posts the
   * form by itself once its invisible CAPTCHA is solved and spins until its server answers. Pressing Send
   * again then starts a new CAPTCHA and the agent called a sent form stuck (AnywhereNow).
   * Waits up to `startMs` for a post to leave and then for its answer (at most 90 s). True when the site
   * sent something since `since`; false when nothing went out, so pressing again is safe.
   */
  private async waitWhileSending(page: Page, since: number, startMs: number): Promise<boolean> {
    const t0 = Date.now()
    let waited = false
    while (Date.now() - t0 < 90_000) {
      if (this.sent && this.sent.outcome !== 'rejected') return true
      if (this.sending > 0 && !waited) {
        waited = true
        this.log('the site is still sending the application; waiting for its answer')
      }
      if (!this.sending && Date.now() - t0 >= startMs) break
      await page.waitForTimeout(500)
    }
    return this.lastSendAt >= since || !!this.sent
  }

  private async submitAndConfirm(submit: ScannedButton) {
    await this.inFront()
    const page = this.page!
    // What you typed in the panel while the AI was filling is done before the application goes out.
    await this.followNotes()
    await this.settleTurnstile()
    // You may have pressed Send yourself while the AI waited for the CAPTCHA.
    if (await this.settleBySignal()) return
    // "Don't click submit": the form stays filled for you to send.
    const hold = this.instructions.find(asksNotToSubmit)
    if (hold) {
      await this.shot('filled-you-send')
      throw new AttemptStop('AWAITING_REVIEW', `Filled and stopped before Submit, as you asked ("${hold.slice(0, 80)}"). Review it and press Submit yourself.`)
    }
    const before = page.url()
    const submittedAt = new Date()
    this.log(`pressing "${submit.text}"`)
    // A cookie banner over the button swallowed the press (MVST).
    await dismissCookies(page).catch(() => false)
    let { frames } = await scanPage(page)
    // Hidden browser: the press happens with the tab in front, so it is a real click.
    await inFrontOf(page, () => clickAndFollow(page, frames, submit))
    let repaired = false
    let pressedAgain = false
    let pressedAfterCaptcha = false
    for (let round = 0; round < 6; round++) {
      await page.waitForTimeout(round === 0 ? 2500 : 3500)
      if (await this.settleBySignal()) return
      const now = await scanPage(page)
      const scan = now.scan
      frames = now.frames
      const urlLooksDone = /thank|confirm|success|submitted|applied|complete/i.test(new URL(page.url()).pathname + new URL(page.url()).search)
      const formGone = !scan.buttons.some((b) => b.kind === 'submit') && relevantFields(scan).filter((f) => f.visible).length === 0
      // Teamtailor's /applications/email_verification_needed: nothing is sent until the person clicks the mailed link
      // (Axians, "Conclua a candidatura"). Not a submission.
      if (EMAIL_VERIFY_URL_RE.test(page.url())) {
        if (await this.followEmailedLink(submittedAt)) {
          await this.shot('submitted')
          await this.markSubmitted('Confirmed through the link the site emailed')
          return
        }
        throw new AttemptStop('NEEDS_HUMAN', 'Not finished yet: the site emailed a confirmation link. Click it in the email to complete this application.')
      }
      if (scan.successText || (urlLooksDone && page.url() !== before) || (formGone && page.url() !== before)) {
        await this.shot('submitted')
        await this.markSubmitted(scan.successText ?? page.url())
        return
      }
      // Greenhouse also shows "Security code is empty" as an error: that is the emailed code, not a form problem.
      const codeAsked =
        scan.codePrompt ||
        relevantFields(scan).some((f) => f.visible && /(security|verification|confirmation) code/i.test(f.label)) ||
        scan.errors.some((e) => /(security|verification) code|code (was|has been) (sent|emailed)/i.test(e))
      if (codeAsked) {
        this.log('the site sent a security code by email; reading it from Gmail')
        const code = await waitForEmailCode({
          since: submittedAt,
          from: /greenhouse|lever|ashby|workday|smartrecruiters|workable|recruitee|teamtailor|personio|no-?reply|careers|talent/i,
          about: this.job.companyName,
          // "Job Application for Staff Product Engineer, AI at Fin": the name the board (and its email) uses.
          aliases: [/\bat (.+?)\s*$/.exec(await page.title().catch(() => ''))?.[1] ?? ''],
          log: (m) => this.log(m),
        })
        if (!code) throw new AttemptStop('NEEDS_HUMAN', 'The site asks for the code it emailed you. Enter it in the apply browser and submit (Gmail must be connected for the agent to read it).')
        await this.enterCode(scan, frames, code)
        const again = await scanPage(page)
        const btn = this.pickButton(again.scan, 'submit') ?? again.scan.buttons.find((b) => /verify|confirm|continue|submit/i.test(b.text) && b.visible && !b.disabled)
        if (btn) await inFrontOf(page, () => clickAndFollow(page, again.frames, btn))
        continue
      }
      // Workable shows Cloudflare's "Verify you are human" only after Submit, inside a closed shadow root
      // the scan cannot read (Keylane, Expereo, Genetec stuck on "Submitting..."): its frame gives it away.
      if (!pressedAfterCaptcha && (scan.captcha?.challengeVisible || page.frames().some((fr) => /challenges\.cloudflare\.com/.test(fr.url())))) {
        // Turnstile after Submit (Workable) often passes by itself within seconds in a normal Chrome.
        const turnstile = scan.captcha?.kind === 'turnstile' || !scan.captcha
        const solvedAt = Date.now()
        if (!(turnstile && (await waitForTurnstile(page, 20_000)))) await this.handleCaptcha()
        else this.log('Turnstile passed by itself')
        pressedAfterCaptcha = true
        // Recruitee sends the form by itself once the CAPTCHA is solved: wait for that, never press twice.
        if (await this.waitWhileSending(page, solvedAt - 5_000, 8_000)) continue
        // Solved, but the form still waits for Submit (Contabo on Personio went round six times): press it
        // once more. The Turnstile frame stays on the page afterwards, so this runs once.
        const again = await scanPage(page)
        const btn = this.pickButton(again.scan, 'submit')
        if (btn) {
          this.log(`CAPTCHA passed; pressing "${btn.text}" again`)
          await inFrontOf(page, () => clickAndFollow(page, again.frames, btn))
        }
        continue
      }
      const problems = this.problems(scan)
      // Ashby lists "Missing entry for required field: <question>" in a banner even when the box shows text.
      const named = relevantFields(scan).filter(
        (f) => f.visible && !problems.some((p) => p.key === f.key) && f.label.length >= 8 && scan.errors.some((e) => normalizeQuestion(e).includes(normalizeQuestion(f.label).slice(0, 80))),
      )
      // "Upload your resume cannot be left blank" while the CV box carried another label (Eightfold):
      // the site's message points the upload rule at the first empty file box.
      const cvError = scan.errors.find((e) => /resume|\bcv\b|curriculum|lebenslauf/i.test(e))
      const cvBox = cvError ? relevantFields(scan).find((f) => f.kind === 'file' && !f.value && !problems.some((p) => p.key === f.key)) : undefined
      if (cvBox) cvBox.error = cvBox.error || cvError!
      const toFix = [...problems, ...named, ...(cvBox && !named.some((n) => n.key === cvBox.key) ? [cvBox] : [])]
      // Nothing happened and nothing is wrong: a late cookie banner over the button, or a click the page
      // missed (THEKER, Smappee). Clear banners and press once more.
      if (round === 1 && !toFix.length && !scan.errors.length && !pressedAgain) {
        pressedAgain = true
        // The press did go out (a post left after it): wait for the answer instead of sending twice.
        if (await this.waitWhileSending(page, submittedAt.getTime(), 0)) continue
        const btn = this.pickButton(scan, 'submit')
        if (btn) {
          await dismissCookies(page).catch(() => false)
          this.log(`no reaction yet; pressing "${btn.text}" again`)
          await inFrontOf(page, () => clickAndFollow(page, frames, btn))
          continue
        }
      }
      if ((toFix.length || scan.errors.length) && !repaired) {
        repaired = true
        this.log(`the site reported a problem: ${[...scan.errors, ...problems.map((p) => p.error || `${p.label} is empty`)].slice(0, 3).join('; ')}`, 'warn')
        if (toFix.length) await this.planAndFill(toFix, frames, new Set(toFix.map((p) => p.key)))
        const again = await scanPage(page)
        const btn = this.pickButton(again.scan, 'submit')
        if (btn) {
          await inFrontOf(page, () => clickAndFollow(page, again.frames, btn))
          continue
        }
      }
    }
    await this.shot('after-submit')
    // Gemini reads the page before a person has to: Trading 212's "You're all set - we've got your
    // application" was missed by the patterns, and a blocker named by the page beats a generic stop.
    const verdict = await this.judgeSubmit(page).catch(() => null)
    if (verdict?.submitted) {
      this.log(`Gemini read the page as submitted: ${verdict.evidence}`)
      await this.markSubmitted(verdict.evidence || page.url())
      return
    }
    // "An application has already been submitted for this job": an earlier try went through after all.
    if (verdict?.detail && /already (been )?(submitted|applied|received)|already applied|application (has )?already been/i.test(verdict.detail)) {
      this.log(`the site says this job was applied to before: ${verdict.detail}`)
      await this.markSubmitted(`Already applied (the site says: ${verdict.detail.slice(0, 160)})`)
      return
    }
    if (verdict?.blocker === 'captcha') await this.handleCaptcha()
    throw new AttemptStop('NEEDS_HUMAN', verdict?.detail ? `Pressed Submit; the page says: ${verdict.detail.slice(0, 200)}` : 'Pressed Submit but saw no confirmation. Please check the open tab; if it went through, press "I submitted it".')
  }

  /**
   * Teamtailor holds some applications until the emailed "confirm your application" link is opened. The
   * agent reads that link from Gmail (only an email about this company, at most 10 minutes old, on the
   * careers site's own domain or teamtailor.com) and opens it in the same tab. It confirms the person's email for
   * this application only; it never signs in, sets a password or creates an account.
   */
  private async followEmailedLink(since: Date): Promise<boolean> {
    const page = this.page!
    const teamtailor = this.target.ats === 'teamtailor' || adapterFor(page.url())?.id === 'teamtailor' || (await page.evaluate(() => /teamtailor/i.test(document.documentElement.innerHTML.slice(0, 200_000))).catch(() => false))
    if (!teamtailor) return false
    const pageHost = escapeRegex(hostOf(page.url()))
    this.log('the site emailed a confirmation link; reading it from Gmail')
    const link = await waitForEmailLink({
      since,
      host: new RegExp(String.raw`^https?://([a-z0-9-]+\.)*(${pageHost}|teamtailor\.com)(/|$)`, 'i'),
      about: this.job.companyName,
      maxAgeMs: 10 * 60_000,
      timeoutMs: 150_000,
      log: (m) => this.log(m),
    })
    if (!link) return false
    this.log('opening the confirmation link from the email')
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
    await settle(page, 1500)
    const { scan } = await scanPage(page)
    if (scan.successText) return true
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? '').catch(() => '')
    if (/(application|candidatura|bewerbung|candidature|sollicitatie)[^.]{0,60}(confirmed|received|sent|submitted|confirmada|recebida|enviada|bestätigt|eingegangen|confirmée|ontvangen)|thank you|obrigad|danke|merci|gracias|bedankt/i.test(text)) return true
    const verdict = await this.judgeSubmit(page).catch(() => null)
    return verdict?.submitted === true
  }

  /** After Submit without a recognised confirmation: did it go through, and if not, what stops it? */
  private async judgeSubmit(page: Page): Promise<SubmitVerdict | null> {
    const { scan } = await scanPage(page)
    const text = await page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 3000) ?? '').catch(() => scan.textSample)
    this.aiCalls++
    const r = await generateJson({
      task: 'submit_check',
      model: 'lite',
      schema: submitVerdictSchema,
      temperature: 0,
      maxOutputTokens: 400,
      system:
        'You check whether a job application was submitted, from the page shown right after pressing Submit. submitted=true only when the page clearly confirms it (thank you, received, all set, success). If the form is still there with errors, a CAPTCHA / "verify you are human", an unticked required box or an empty required field, it was not submitted: name the blocker. evidence quotes the confirming words; detail says in one short sentence what blocks it. Answer ONLY with JSON.',
      prompt: `Job: ${this.job.title} at ${this.job.companyName}\nURL: ${page.url()}\nErrors shown: ${scan.errors.slice(0, 6).join(' | ') || 'none'}\nButtons: ${scan.buttons.filter((b) => b.visible).slice(0, 12).map((b) => b.text).join(' | ')}\nPage text: ${text}`,
    })
    return r.data
  }

  private async enterCode(scan: PageScan, frames: Frame[], code: string) {
    const boxes = relevantFields(scan).filter((f) => f.visible && (f.kind === 'text' || f.kind === 'number' || f.kind === 'tel') && (f.maxLength === null || f.maxLength <= 12))
    const singles = boxes.filter((f) => f.maxLength === 1)
    if (singles.length >= code.length) {
      for (let i = 0; i < code.length; i++) {
        await frames[singles[i].frame ?? 0].locator(`[data-jf-key="${singles[i].key}"]`).first().fill(code[i]).catch(() => undefined)
      }
    } else {
      // Real keystrokes: split code boxes (Greenhouse) move to the next box by themselves.
      const labelled = frames.map((f) => f.getByLabel(/security code|verification code/i).first())
      const box = boxes[0] ? frames[boxes[0].frame ?? 0].locator(`[data-jf-key="${boxes[0].key}"]`).first() : await firstVisible(labelled)
      if (!box) throw new AttemptStop('NEEDS_HUMAN', 'The site asks for the code it emailed you, but the agent could not find the code box. Enter it in the browser and submit.')
      await withKeyboard(box, async () => {
        await box.click({ timeout: 5000 }).catch(() => undefined)
        await box.pressSequentially(code, { delay: 60 })
      })
    }
    this.log('entered the code')
  }

  // ---------------------------------------------------------------- outcomes

  private async markSubmitted(evidence: string) {
    const now = new Date()
    const channel = this.app.channel === 'email' ? (this.target.ats ? 'ats' : 'portal') : this.app.channel
    this.log(`submitted (${evidence.slice(0, 120)})`)
    await this.save({ status: 'SUBMITTED', finishedAt: now, finalUrl: this.page?.url() ?? null, tabId: null })
    await db.application.update({
      where: { id: this.app.id },
      data: {
        status: 'SENT',
        sentAt: now,
        submittedVia: 'agent',
        channel,
        portalStatus: 'SUBMITTED',
        experiment: json(formExperiment({ site: this.target.site, by: 'agent', batchId: this.attempt.batchId })),
        lastActivityAt: now,
        followUpDueAt: null,
        scheduledFor: null,
        ...(this.page && isWorkdayUrl(this.page.url()) ? { portalStatusUrl: workdayStatusUrl(this.page.url()) } : {}),
      },
    })
    await db.job.update({ where: { id: this.job.id }, data: { status: 'APPLIED' } })
    await resolveNeedsYou(this.app.id)
    await db.applicationEvent.create({ data: { applicationId: this.app.id, type: 'submitted', message: `Submitted on ${hostOf(this.page?.url() ?? this.target.url)} by the browser agent`, meta: json({ attemptId: this.attempt.id, evidence: evidence.slice(0, 300) }) } })
    await notify('sent', `Applied: ${this.job.title} at ${this.job.companyName}`, `Submitted through ${this.target.site === 'other' ? hostOf(this.target.url) : this.target.site}.`, `/applications/${this.app.id}`)
  }

  private async fail(err: unknown): Promise<AttemptOutcome> {
    let stop =
      err instanceof AttemptStop
        ? err
        : err instanceof BrowserUnavailableError
          ? new AttemptStop('FAILED', err.message, 'browser')
          : new AttemptStop('FAILED', err instanceof Error ? err.message.split('\n')[0].slice(0, 500) : String(err))
    // The site already took the application (maybe the person's own press of Send in the tab): whatever went wrong
    // afterwards, the tab closing included, it is sent. Retrying once sent Powerprozesse's form twice.
    if (this.sent && (this.sent.outcome === 'sent' || this.sent.outcome === 'already') && !this.app.sentAt) {
      this.keepTab = false
      await this.markSubmitted(this.sent.outcome === 'already' ? `Already applied: ${describeSignal(this.sent)}` : describeSignal(this.sent))
      return { status: 'SUBMITTED', reason: describeSignal(this.sent) }
    }
    if (this.sent?.outcome === 'company_limit') stop = new AttemptStop('CANCELLED', `Not sent: ${describeSignal(this.sent)}`)
    // You opened it and the tab closed: you may have sent it yourself on a site whose answer is not read,
    // so it is not tried again by itself (that sent Powerprozesse twice); it waits for you to say.
    if (this.interactive && stop.status === 'FAILED' && TAB_CLOSED_RE.test(stop.reason)) {
      stop = new AttemptStop('NEEDS_HUMAN', `The tab closed before the AI finished. If you sent the application yourself, press "I submitted it"; if not, press Open with AI again.`)
    }
    // "You have already applied to this position" on the page or in Submit's 400 answer (Eightfold, John
    // Deere): the press went through, or an earlier one did. Nothing is left for the user to do.
    if ((stop.status === 'NEEDS_HUMAN' || stop.status === 'FAILED') && this.page && !this.page.isClosed()) {
      const already = this.alreadyApplied ? 'the site answered Submit with "already applied"' : await alreadyAppliedText(this.page).catch(() => null)
      if (already && !this.app.sentAt) {
        this.keepTab = false
        await this.markSubmitted(`Already applied: ${already}`)
        return { status: 'SUBMITTED', reason: `Already applied: ${already}` }
      }
      if (already) stop = new AttemptStop('CANCELLED', 'Already applied to this job')
    }
    // A knockout gate ("you have to meet these requirements" after a truthful "No"): the form cannot be
    // sent, so the job is closed as not eligible instead of waiting for the user (Varm, Berlin).
    if ((stop.status === 'NEEDS_HUMAN' || stop.status === 'FAILED') && this.page && !this.page.isClosed()) {
      const ko = (await knockoutText(this.page).catch(() => null)) ?? stop.reason.match(KNOCKOUT_RE)?.[0] ?? null
      if (ko) {
        stop = new AttemptStop('CANCELLED', `Not eligible: the form stops on a requirement you truthfully do not meet ("${ko}")`)
        this.keepTab = false
      }
    }
    // Gemini already read the gate ("Not eligible: ..." from the driver) but the tab is gone.
    const geminiKo = stop.status === 'NEEDS_HUMAN' ? stop.reason.match(/Not eligible: .*/)?.[0] : undefined
    if (geminiKo) {
      stop = new AttemptStop('CANCELLED', geminiKo.slice(0, 300))
      this.keepTab = false
    }
    // A CAPTCHA closes its tab instead of waiting open in the user's Chrome; the job is listed for the user to do together with the agent later.
    if (stop.status === 'NEEDS_HUMAN' && /captcha/i.test(stop.reason) && !stop.reason.startsWith('CAPTCHA')) {
      stop = new AttemptStop('NEEDS_HUMAN', 'CAPTCHA, waiting for you: press Open with AI on this application; the AI fills the form, you solve the CAPTCHA and it submits.')
    }
    const captchaWait = stop.status === 'NEEDS_HUMAN' && stop.reason.startsWith('CAPTCHA')
    const notEligible = stop.status === 'CANCELLED' && stop.reason.startsWith('Not eligible')
    const now = new Date()
    // Tabs of the hidden agents browser cannot be shown to you, so only visible ones are kept, and only when
    // someone looks after them: you started this one, or a hand-over watcher takes it over (it closes after
    // 20 minutes untouched). A sign-in wall or a "maybe sent" page found while you are away closes; the job
    // waits in "needs you" (such tabs once piled up in the user's Chrome overnight).
    const watched = this.interactive || stop.status === 'AWAITING_REVIEW' || canHandOver(stop.reason)
    if ((stop.status === 'AWAITING_REVIEW' || stop.status === 'NEEDS_HUMAN') && !this.settings.portal.headless && !captchaWait && watched) this.keepTab = true
    // One tab per application: an earlier try's tab is still open with its answers, so this one closes.
    if (this.keepTab && stop.status === 'NEEDS_HUMAN' && (await earlierTabOpen(this.app.id, this.attempt.id).catch(() => false))) {
      this.keepTab = false
      this.log('an earlier tab for this application is still open with its answers; closing this one')
    }
    if (stop.status !== 'AWAITING_REVIEW') this.log(stop.reason, stop.status === 'FAILED' ? 'error' : 'warn')
    if (stop.status === 'FAILED' && !(err instanceof AttemptStop)) await this.shot('error')
    const diagnosis = await this.diagnose(stop)
    const tabId = this.keepTab && this.page && !this.page.isClosed() ? await tabIdOf(this.page) : null
    await this.save({
      status: stop.status,
      finishedAt: now,
      finalUrl: this.page && !this.page.isClosed() ? this.page.url() : null,
      tabId,
      ...(diagnosis ? { diagnosis: json(diagnosis) } : {}),
      ...(stop.status === 'NEEDS_HUMAN' ? { needsHumanReason: stop.reason } : {}),
      ...(stop.status === 'FAILED' || stop.status === 'CANCELLED' ? { error: stop.reason } : {}),
    })
    // A late run that stops with "already applied" must not hide the earlier submission.
    const appData: Prisma.ApplicationUpdateInput = { lastActivityAt: now, ...(this.app.portalStatus === 'SUBMITTED' ? {} : { portalStatus: stop.status }) }
    if (!this.app.sentAt) {
      if (stop.status === 'AWAITING_REVIEW') appData.status = 'REVIEW'
      else if (stop.status === 'NEEDS_HUMAN') appData.status = 'NEEDS_HUMAN'
      else if (notEligible) appData.status = 'SKIPPED'
    }
    await db.application.update({ where: { id: this.app.id }, data: appData }).catch(() => undefined)
    if (stop.status === 'AWAITING_REVIEW') {
      await db.applicationEvent.create({ data: { applicationId: this.app.id, type: 'filled', message: 'Form filled by the browser agent; waiting for your review', meta: json({ attemptId: this.attempt.id }) } })
      await notify('review_needed', `Review and submit: ${this.job.title} at ${this.job.companyName}`, 'The form is filled and waiting in the apply browser.', `/applications/${this.app.id}`)
    } else if (stop.status === 'NEEDS_HUMAN') {
      await db.applicationEvent.create({ data: { applicationId: this.app.id, type: 'needs_human', message: stop.reason.slice(0, 500), meta: json({ attemptId: this.attempt.id }) } })
      await notify('review_needed', `Browser apply needs you: ${this.job.title} at ${this.job.companyName}`, stop.reason.slice(0, 300), `/applications/${this.app.id}`)
    }
    return { status: stop.status, reason: stop.reason, code: stop.code }
  }

  /**
   * Every stop that is about the form gets a "why": Gemini looks at a screenshot of where it stopped, the
   * page and the last actions, and names the blocker, the field and how to get past it next time. Not for
   * stops whose reason is already plain (CAPTCHA, browser or network gone, paused), and never longer
   * than 45 seconds.
   */
  private async diagnose(stop: AttemptStop): Promise<Record<string, unknown> | null> {
    if (stop.status !== 'NEEDS_HUMAN' && stop.status !== 'FAILED') return null
    if (!this.page || this.page.isClosed() || !/^https?:/.test(this.page.url())) return null
    if (/^CAPTCHA|your chrome|worker restarted|network|browser has been closed|target page, context or browser|paused|quota/i.test(stop.reason)) return null
    const page = this.page
    const shot = await viewportShot(page)
    if (shot) this.keepStepShot(shot, 'stopped-here')
    this.aiCalls++
    const d = await Promise.race([
      diagnoseStop({ page, reason: stop.reason, job: { title: this.job.title, company: this.job.companyName }, history: this.driveHistory, shot, candidate: this.ctx?.candidate }),
      new Promise<null>((r) => setTimeout(() => r(null), 45_000)),
    ]).catch(() => null)
    if (!d) return null
    this.log(`why it stopped (${d.category}): ${d.blocker}${d.fixHint ? ` | next time: ${d.fixHint}` : ''}`, 'warn')
    return { ...d, at: new Date().toISOString() }
  }

  /**
   * "Send your CV to jobs@firm.com" (EURES, small boards): the job becomes an email application. The
   * draft waits for your approval like any other; this never queues or sends it.
   */
  private async switchToEmail(address: string) {
    await db.job.update({ where: { id: this.job.id }, data: { contactEmail: address, contactEmailSource: 'apply-page', applyChannel: 'email' } })
    await db.application.update({ where: { id: this.app.id }, data: { channel: 'email', toEmail: address } })
    // A few AI calls: they run beside the agent, which moves on to the next job.
    void draftApplication(this.job.id, { force: true, fast: true }).catch((err: unknown) => this.log(`could not draft the email: ${err instanceof Error ? err.message : err}`, 'warn'))
  }

  /**
   * A tab of this attempt: closed at the end, mailto links blocked, and its pop-ups tracked too (Playwright
   * reports them even for rel=noopener links, whose opener() is null). A Submit answered with "already
   * applied" (a 4xx body) is remembered for fail().
   */
  private track(p: Page) {
    if (this.ownPages.has(p)) return
    this.ownPages.add(p)
    // You opened this one: the panel's box on the form talks to this attempt.
    if (this.interactive) void listenForAsks(p, this.onAsk).catch(() => undefined)
    void blockMailtoLinks(p)
    p.on('popup', (q) => this.track(q))
    this.unwatchSubmits.push(watchSubmits(p, {
      onStart: () => {
        this.sending++
        this.lastSendAt = Date.now()
      },
      onEnd: () => {
        this.sending = Math.max(0, this.sending - 1)
      },
      onSignal: (s) => {
        // A later "rejected" never hides an earlier "sent".
        if (this.sent && this.sent.outcome !== 'rejected') return
        this.sent = s
        this.log(`the site answered: ${describeSignal(s)}`)
      },
    }))
    p.on('response', (res) => {
      if (this.alreadyApplied || res.status() < 400 || res.request().method() !== 'POST') return
      void res
        .text()
        .then((t) => {
          if (ALREADY_APPLIED_RE.test(t.slice(0, 4000))) this.alreadyApplied = true
        })
        .catch(() => undefined)
    })
  }

  /** Close the tab unless you need it; keep at most `maxOpenTabs` waiting tabs. */
  private async cleanupTab() {
    for (const p of this.ownPages) stopListening(p, this.onAsk)
    for (const stop of this.unwatchSubmits.splice(0)) stop()
    if (this.page && !this.page.isClosed() && !this.keepTab) await this.page.close().catch(() => undefined)
    // The posting tab left behind when "Apply" opened the form in a new tab, and other pop-ups of this run.
    this.stopWatchingTabs?.()
    for (const p of this.ownPages) {
      if (p.isClosed() || (this.keepTab && p === this.page)) continue
      await p.close().catch(() => undefined)
    }
    if (this.keepTab && this.page && !this.page.isClosed()) rememberKeptTab(this.page, this.app.id)
    await capKeptTabs(this.context).catch(() => undefined)
    const max = this.settings.portal.maxOpenTabs
    const waiting = await db.portalAttempt.findMany({ where: { tabId: { not: null }, status: { in: ['AWAITING_REVIEW', 'NEEDS_HUMAN'] } }, orderBy: { finishedAt: 'desc' }, select: { id: true, tabId: true } })
    if (waiting.length <= max) return
    try {
      const { context } = await connectApplyBrowser(this.settings.portal, { launch: false })
      for (const w of waiting.slice(max)) {
        const tab = await findTab(context, w.tabId)
        await tab?.close().catch(() => undefined)
        await db.portalAttempt.update({ where: { id: w.id }, data: { tabId: null } })
      }
    } catch {
      /* browser gone: nothing to close */
    }
  }
}

/**
 * Run one queued attempt. `interactive` = you started it and may be watching (waits for CAPTCHAs).
 * `background` = one of the parallel agents: it works in the hidden agents browser.
 */
/**
 * "Apply by email" links in the app's own tabs never reach the OS: Chrome hands mailto: to the user's mail app,
 * and Gemini clicking Jobindex's Apply 19 times opened and closed Outlook 19 times.
 * The address is kept on window.__jfMailto for anything that wants it. Only tabs this app opened.
 */
async function blockMailtoLinks(page: Page): Promise<void> {
  const script = () => {
    document.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a[href^="mailto:" i]')
        if (!a) return
        e.preventDefault()
        e.stopImmediatePropagation()
        ;(window as unknown as { __jfMailto?: string }).__jfMailto = a.getAttribute('href') ?? ''
      },
      true,
    )
  }
  await page.addInitScript(script).catch(() => undefined)
  await page.evaluate(script).catch(() => undefined)
}

export async function runPortalAttempt(attemptId: string, opts: { interactive?: boolean; background?: boolean } = {}): Promise<AttemptOutcome> {
  const attempt = await db.portalAttempt.findUnique({
    where: { id: attemptId },
    include: { application: { include: { job: { include: { score: true, company: true, sourceLinks: { select: { source: true, externalId: true, url: true } } } } } } },
  })
  if (!attempt) return { status: 'FAILED', reason: 'attempt not found' }
  if (attempt.status !== 'QUEUED') return { status: attempt.status as AttemptStatus }
  const settings = await getSettings()
  const portal: BrowserConfig = opts.background ? agentsBrowserConfig(settings.portal) : settings.portal
  return new AttemptRunner(attempt, { ...settings, portal }, opts.interactive ?? false).run()
}

export const INTERRUPTED_ERROR = 'Worker restarted during the attempt'

/**
 * Mark attempts left RUNNING by a worker that died. Returns the standalone (non-batch) ones that were interrupted
 * for the first time, so the caller can try them once more; batches pick their own failures up again.
 */
export async function failInterruptedAttempts(): Promise<{ count: number; retry: { applicationId: string; mode: string }[] }> {
  const running = await db.portalAttempt.findMany({ where: { status: 'RUNNING' }, select: { applicationId: true, mode: true, batchId: true } })
  const r = await db.portalAttempt.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', error: INTERRUPTED_ERROR, finishedAt: new Date() } })
  if (r.count) await db.application.updateMany({ where: { portalStatus: 'RUNNING' }, data: { portalStatus: 'FAILED' } })
  // A batch claim runs its attempt in-process right away (no queue job): one still QUEUED at startup was cut
  // off between claim and start, and would hold its company forever (11 once sat there for 17 hours).
  const orphans = await db.portalAttempt.findMany({ where: { status: 'QUEUED', batchId: { not: null } }, select: { applicationId: true } })
  if (orphans.length) {
    await db.portalAttempt.updateMany({ where: { status: 'QUEUED', batchId: { not: null } }, data: { status: 'CANCELLED', error: INTERRUPTED_ERROR, finishedAt: new Date() } })
    await db.application.updateMany({ where: { id: { in: orphans.map((o) => o.applicationId) }, portalStatus: 'QUEUED' }, data: { portalStatus: 'CANCELLED' } })
  }
  const retry: { applicationId: string; mode: string }[] = []
  for (const a of running.filter((x) => !x.batchId)) {
    // Two interruptions on the same application likely mean the form itself crashes the worker: leave it.
    const before = await db.portalAttempt.count({ where: { applicationId: a.applicationId, error: INTERRUPTED_ERROR } })
    if (before === 1) retry.push({ applicationId: a.applicationId, mode: a.mode })
  }
  return { count: r.count, retry }
}
