import type { Frame, Page } from 'playwright'
import { generateJson } from '@/lib/ai/gemini'
import { navDecisionSchema } from '@/lib/ai/schemas'
import { runInFrame, scanFrameInPage } from './inpage'
import { hostOf, normalizeQuestion } from './match'
import type { PageScan, ScannedButton, ScannedField } from './types'

/** Third-party frames that never hold the application form. */
const SKIP_FRAME_RE = /recaptcha|hcaptcha|challenges\.cloudflare|doubleclick|googletagmanager|google-analytics|googlesyndication|facebook\.com\/tr|youtube\.com|vimeo|hotjar|intercom|drift\.com|zendesk|onetrust|cookielaw|cookiebot|usercentrics|linkedin\.com\/px|js\.stripe|stripe\.com\/v3|qualtrics|surveymonkey|wistia|loom\.com/i

/** Sites whose terms forbid bots; the agent never works there (apply by hand in the same browser). */
export const BLOCKED_HOSTS_RE = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|xing\.com|glassdoor\.[a-z.]+|monster\.[a-z.]+)$/i

/** LinkedIn is allowed only for Easy Apply, when you turned it on (Settings → Browser). */
export function isBlockedHost(url: string, allowLinkedIn = false): boolean {
  const host = hostOf(url)
  if (allowLinkedIn && /(^|\.)linkedin\.com$/i.test(host)) return false
  return BLOCKED_HOSTS_RE.test(host)
}

export async function settle(page: Page, extraMs = 700): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 7_000 }).catch(() => undefined)
  await page.waitForTimeout(extraMs)
}

export function usableFrames(page: Page): Frame[] {
  const main = page.mainFrame()
  const rest = page.frames().filter((f) => f !== main && !f.isDetached() && !SKIP_FRAME_RE.test(f.url()) && f.url() !== 'about:blank')
  return [main, ...rest]
}

/**
 * A CAPTCHA a person has answered: reCAPTCHA, hCaptcha and Turnstile put their token in the form. The
 * ticked "I'm not a robot" box stays on screen, so its frame alone does not say whether it is solved.
 */
export async function captchaAnswered(page: Page): Promise<boolean> {
  const found = await Promise.all(
    page.frames().map((f) =>
      f
        .evaluate(() =>
          Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="h-captcha-response"], input[name="cf-turnstile-response"]')).some(
            (el) => (el.value || '').length > 20,
          ),
        )
        .catch(() => false),
    ),
  )
  return found.some(Boolean)
}

/** Scan the page and its frames into one view. Field and button `frame` = index in `frames`. */
export async function scanPage(page: Page): Promise<{ scan: PageScan; frames: Frame[] }> {
  const frames = usableFrames(page)
  const parts = await Promise.all(
    frames.map((frame, i) =>
      runInFrame(frame, scanFrameInPage, { prefix: `f${i}k` }).catch(() => null),
    ),
  )
  const scan: PageScan = {
    url: page.url(),
    title: await page.title().catch(() => ''),
    fields: [],
    buttons: [],
    headings: [],
    textSample: '',
    hasPassword: false,
    captcha: null,
    successText: null,
    errors: [],
    codePrompt: false,
    frames: frames.length,
  }
  parts.forEach((p, i) => {
    if (!p) return
    scan.fields.push(...p.fields.map((f) => ({ ...f, frame: i })))
    scan.buttons.push(...p.buttons.map((b) => ({ ...b, frame: i })))
    scan.headings.push(...p.headings)
    scan.textSample += (scan.textSample ? '\n' : '') + p.textSample.slice(0, i === 0 ? 5000 : 2500)
    scan.hasPassword ||= p.hasPassword
    scan.captcha ??= p.captcha
    scan.successText ??= p.successText
    scan.errors.push(...p.errors)
    scan.codePrompt ||= p.codePrompt
  })
  return { scan, frames }
}

const NOISE_FIELD_RE = /\b(search|keyword|newsletter|subscribe|job alert|filter|sort by|language selector|select language)\b/

/** Visible fields that belong to an application (not site search or newsletter boxes). */
export function relevantFields(scan: PageScan): ScannedField[] {
  return scan.fields.filter((f) => (f.visible || f.kind === 'file') && !NOISE_FIELD_RE.test(normalizeQuestion(f.label)))
}

export function looksLikeApplicationForm(scan: PageScan): boolean {
  const fields = relevantFields(scan).filter((f) => f.kind !== 'password')
  const hasResume = fields.some((f) => f.kind === 'file' && /resume|cv|curriculum|lebenslauf|attach|upload/i.test(`${f.label} ${f.name} ${f.id}`))
  const hasEmail = fields.some((f) => f.kind === 'email' || /e-?mail/i.test(f.label))
  const visible = fields.filter((f) => f.visible && f.kind !== 'file')
  if (hasResume && visible.length >= 1) return true
  if (hasEmail && visible.length >= 3) return true
  // A newsletter box (an email and a consent tick + "Continue", Stripe's "Get industry insights") is no application step.
  if (hasEmail && visible.every((f) => f.kind === 'email' || f.kind === 'checkbox' || /e-?mail/i.test(f.label))) return false
  // A job-alert box (name, email, consent and "Subscribe", NoFluffJobs) with no CV and no real Submit.
  const alertButton = /subscribe|newsletter|job alerts?|notify me|get alerts|sign ?up for/i
  if (!hasResume && scan.buttons.some((b) => b.visible && alertButton.test(b.text)) && !scan.buttons.some((b) => b.visible && b.kind === 'submit' && !alertButton.test(b.text))) return false
  // Later steps of a wizard (questions, disclosures) have no email/CV but do have Next/Submit.
  return visible.length >= 2 && scan.buttons.some((b) => b.kind === 'next' || b.kind === 'submit')
}

export function isLoginPage(scan: PageScan): boolean {
  if (!scan.hasPassword) return false
  const fields = relevantFields(scan).filter((f) => f.visible)
  return !fields.some((f) => f.kind === 'file') && fields.length <= 6
}

/** Close cookie banners: "reject all / necessary only" when offered, else accept. */
export async function dismissCookies(page: Page): Promise<boolean> {
  const ids = [
    '#onetrust-reject-all-handler',
    '#CybotCookiebotDialogBodyButtonDecline',
    'button[data-testid="uc-deny-all-button"]',
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[data-testid="uc-accept-all-button"]',
  ]
  for (const sel of ids) {
    const b = page.locator(sel).first()
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 4000 }).catch(() => undefined)
      await page.waitForTimeout(400)
      return true
    }
  }
  const banner = page.locator('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [aria-label*="consent" i]').filter({ has: page.locator('button') })
  const names = [
    // Teamtailor in German: "Nicht benötigte Cookies ablehnen" / "Alle Cookies akzeptieren"; its popup
    // swallowed every click on the form underneath (VARM's consent box "did not stick").
    /^(reject all|decline all|decline|deny( all)?|only necessary|necessary only|(agree|consent) to necessary|accept (only )?(necessary|essential)( cookies)?|(only )?essential( cookies)?( only)?|use (only )?necessary cookies( only)?|reject( all)?( cookies)?|(reject|decline) (all )?non.?(essential|necessary)( cookies)?|refuse all|alle ablehnen|(nicht (benötigte|notwendige|erforderliche) )?cookies ablehnen|nicht (benötigte|notwendige) ablehnen|nur (notwendige|erforderliche)( cookies)?( (akzeptieren|zulassen|erlauben))?|tout refuser|refuser( (tout|les cookies))?|continuer sans accepter|rechazar( todas?)?( las cookies)?|alles weigeren|weigeren|afwijzen|rifiuta( tutti)?)$/i,
    /^(accept all|accept( all)? cookies|accept|allow all( cookies)?|agree to all|i accept|i agree|agree|got it|i understand|understood|ok|alle akzeptieren|alle cookies (akzeptieren|zulassen|erlauben)|akzeptieren|tout accepter|accepter( tous les cookies)?|aceptar( todas?)?( las cookies)?|alles accepteren|accepteren|accetta( tutti)?)$/i,
  ]
  for (const name of names) {
    const b = banner.getByRole('button', { name }).first()
    if (await b.isVisible().catch(() => false)) {
      await b.click({ timeout: 4000 }).catch(() => undefined)
      await page.waitForTimeout(400)
      return true
    }
  }
  // A banner without "cookie" in its classes: a visible button with one of those names inside a box
  // whose text talks about cookies. The page marks it, then the click is a real one.
  for (const [i, name] of names.entries()) {
    const marked = await page
      .evaluate(
        ({ source, flags, i }) => {
          const re = new RegExp(source, flags)
          for (const el of Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]'))) {
            const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
            const box = el.getBoundingClientRect()
            if (!re.test(text) || box.width === 0 || box.height === 0) continue
            let up: Element | null = el
            for (let d = 0; up && d < 6; d++, up = up.parentElement) {
              if (/cookie/i.test(up.textContent?.slice(0, 2000) ?? '')) {
                el.setAttribute('data-jf-cookie', String(i))
                return true
              }
            }
          }
          return false
        },
        { source: name.source, flags: name.flags, i },
      )
      .catch(() => false)
    if (!marked) continue
    await page.locator(`[data-jf-cookie="${i}"]`).first().click({ timeout: 4000 }).catch(() => undefined)
    await page.waitForTimeout(400)
    return true
  }
  return false
}

/**
 * A "Terms and Conditions" pop-up over the form with an Agree button (Oracle Cloud careers sites: JPMorgan,
 * BNY, Ciklum). Ticking the terms box only reopens it, and Next behind it does nothing, so press Agree.
 */
export async function acceptTermsDialog(page: Page): Promise<boolean> {
  const marked = await page
    .evaluate(() => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'
      }
      const boxes = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], [class*="dialog" i], [class*="modal" i], [class*="popup" i]'))
      for (const box of boxes) {
        // A pop-up, not a page wrapper (Bootstrap puts "modal-open" on <body>).
        if (box === document.body || box === document.documentElement || !visible(box)) continue
        const text = (box.textContent ?? '').slice(0, 6000)
        if (!/terms|conditions|privacy|consent|acknowledge|data protection/i.test(text) || /cookie/i.test(text.slice(0, 600))) continue
        const button = Array.from(box.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]')).find((b) => {
          const label = ((b as HTMLInputElement).value || b.textContent || '').replace(/\s+/g, ' ').trim()
          return visible(b) && /^(i )?(agree|accept)( (and|&) (continue|proceed))?$/i.test(label)
        })
        if (button) {
          button.setAttribute('data-jf-agree', '1')
          return true
        }
      }
      return false
    })
    .catch(() => false)
  if (!marked) return false
  await page.locator('[data-jf-agree="1"]').first().click({ timeout: 4000 }).catch(() => undefined)
  await page.evaluate(() => document.querySelectorAll('[data-jf-agree]').forEach((el) => el.removeAttribute('data-jf-agree'))).catch(() => undefined)
  await page.waitForTimeout(600)
  return true
}

/**
 * Click a button or link and follow wherever it goes: same tab, a new tab (popup), or an
 * in-page change. Returns the page the flow continues in.
 */
export async function clickAndFollow(page: Page, frames: Frame[], button: ScannedButton): Promise<Page> {
  const frame = frames[button.frame ?? 0] ?? page.mainFrame()
  const loc = frame.locator(`[data-jf-key="${button.key}"]`).first()
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined)
  // Only a tab this page opened: with parallel agents in one browser, any new tab in the context
  // may belong to another agent (Elastic's agent once took Toast's tab and closed it).
  const popupPromise = page.waitForEvent('popup', { timeout: 7000 }).catch(() => null)
  try {
    await loc.click({ timeout: 10_000 })
  } catch (err) {
    // Overlays that catch the click (Workday's click_filter): click through them.
    if (!/intercepts pointer events|not visible|outside of the viewport|Timeout/i.test(err instanceof Error ? err.message : '')) throw err
    await loc.click({ timeout: 5000, force: true }).catch(() => loc.dispatchEvent('click', undefined, { timeout: 5000 }).catch(() => undefined))
  }
  const popup = await Promise.race([popupPromise, new Promise<null>((r) => setTimeout(() => r(null), 2500))])
  if (popup) {
    await settle(popup)
    // "Apply" opening this very page again in a new tab (Scout24, #application-form): stay put, or every
    // further click leaves one more copy behind.
    const samePage = (a: string, b: string) => {
      try {
        const x = new URL(a)
        const y = new URL(b)
        return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '')
      } catch {
        return false
      }
    }
    if (!samePage(popup.url(), page.url())) return popup
    await popup.close().catch(() => undefined)
  }
  await settle(page)
  return page
}

export type FindFormResult =
  | { status: 'form'; page: Page; scan: PageScan; frames: Frame[] }
  | { status: 'login'; page: Page; scan: PageScan; frames: Frame[] }
  | { status: 'captcha'; page: Page; scan: PageScan; frames: Frame[] }
  | { status: 'blocked' | 'notfound' | 'closed'; page: Page; reason: string }
  /** The posting says to apply by email: no form to fill. */
  | { status: 'email'; page: Page; email: string; reason: string }

export function applyRank(b: ScannedButton, jobTitle = ''): number {
  const t = b.text.toLowerCase()
  let r = 0
  // "Apply Now for Software Engineer II...": this job's own button beats the site header's generic one (Elastic).
  const words = normalizeQuestion(jobTitle).split(' ').filter((w) => w.length > 3).slice(0, 4)
  if (words.length && words.every((w) => normalizeQuestion(b.text).includes(w))) r += 6
  if (b.href) {
    try {
      const u = new URL(b.href)
      if (u.pathname.replace(/\/+$/, '') === '' && !u.search) r -= 8 // the site's home ("jobs.elastic.co/#/")
    } catch {
      /* relative or javascript: link */
    }
    if (/[?&](gh_jid|jobid|job_id|jid)=|\/(form|apply|application)(\/|\?|$)/i.test(b.href)) r += 4
  }
  if (/^(apply|apply now|apply for this (job|role|position)|apply online|apply here|jetzt bewerben|bewerben|postuler)$/.test(t)) r += 10
  if (/apply manually/.test(t)) r += 12 // Workday: skip "Autofill with resume"
  if (/^easy apply\b/.test(t)) r += 12 // LinkedIn: the form opens right here, with your profile filled in
  if (/autofill with resume|use my last application/.test(t)) r -= 4
  if (b.tag === 'button') r += 2
  if (/greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|myworkdayjobs|recruitee|teamtailor|personio|join\.com/.test(b.href)) r += 3
  if (b.href && isBlockedHost(b.href)) r -= 100
  return r
}

const CLOSED_RE = /(this (job|position|role|posting) (is|has been) (no longer|closed|filled|expired)|no longer (accepting|available|open)|job (has )?expired|position has been filled|stelle ist (nicht mehr|bereits) (verfügbar|besetzt)|offre (n'est plus|expirée)|page (not found|doesn.t exist)|404)/i

/** Application forms that ATSs serve for embedding in a company's own careers page. */
const ATS_EMBED_RE = /greenhouse\.io\/embed\/job_app|jobs\.ashbyhq\.com\/.+\/embed|jobs\.lever\.co\/.+\/apply|apply\.workable\.com\/.+\/embed|\.recruitee\.com\/o\/|comeet\.(co|com)\/(jobs|careers)|\.teamtailor\.com\/jobs|\.personio\.(de|com)\/job|smartrecruiters\.com|jobs\.jobvite\.com|\.bamboohr\.com\/careers|\.breezy\.hr|\.pinpointhq\.com/i

/**
 * From a posting (or anywhere), get to the application form: follow Apply buttons and links,
 * new tabs included, up to `maxHops`. AI picks the link only when the page is unclear.
 */
export async function findApplicationForm(
  start: Page,
  opts: { log: (m: string) => void; job: { title: string; company: string }; maxHops?: number; useAi: boolean; onAiCall?: () => void; allowLinkedIn?: boolean },
): Promise<FindFormResult> {
  let page = start
  const tried = new Set<string>()
  const pressCount = new Map<string, number>()
  let scrolled = false
  for (let hop = 0; hop <= (opts.maxHops ?? 5); hop++) {
    if (isBlockedHost(page.url(), opts.allowLinkedIn)) return { status: 'blocked', page, reason: `${hostOf(page.url())} does not allow automated applications; apply there by hand in the apply browser` }
    await dismissCookies(page)
    await acceptTermsDialog(page)
    const { scan, frames } = await scanPage(page)
    if (scan.captcha?.challengeVisible) return { status: 'captcha', page, scan, frames }
    if (looksLikeApplicationForm(scan)) {
      // An ATS form inside the company's page (Elastic → Greenhouse embed): open it on its own. In some browsers
      // the frame never renders, and then its dropdowns and ticks cannot be clicked.
      const embed = frames.slice(1).find((fr) => ATS_EMBED_RE.test(fr.url()))
      if (embed && relevantFields(scan).some((f) => (f.frame ?? 0) > 0) && !tried.has(`embed|${embed.url()}`)) {
        tried.add(`embed|${embed.url()}`)
        opts.log(`opening the embedded form on its own (${hostOf(embed.url())})`)
        await page.goto(embed.url(), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
        await settle(page, 1200)
        continue
      }
      return { status: 'form', page, scan, frames }
    }
    if (isLoginPage(scan)) return { status: 'login', page, scan, frames }
    if (hop === 0 && CLOSED_RE.test(scan.textSample.slice(0, 2500)) && !scan.buttons.some((b) => b.kind === 'apply')) {
      return { status: 'closed', page, reason: 'The posting looks closed or removed' }
    }
    // The same button on the same page (query and hash aside) twice is enough: Schwarz's "Apply Now" did
    // nothing and was pressed six times while the address picked up new parameters.
    const pageKey = page.url().split(/[?#]/)[0]
    const pressedTwice = (b: ScannedButton) => (pressCount.get(`${pageKey}|${b.text}`) ?? 0) >= 2
    const candidates = scan.buttons
      .filter((b) => b.kind === 'apply' && !b.disabled && !tried.has(`${page.url()}|${b.text}|${b.href}`) && !pressedTwice(b))
      .sort((a, b) => applyRank(b, opts.job?.title) - applyRank(a, opts.job?.title))
    let next: ScannedButton | undefined = candidates[0]
    if (!next && !scrolled) {
      scrolled = true
      await page.mouse.wheel(0, 20_000).catch(() => undefined)
      await page.waitForTimeout(1200)
      hop--
      continue
    }
    if (!next && opts.useAi) {
      const choice = await askWhereToGo(scan, opts.job, opts.onAiCall).catch(() => null)
      if (choice?.action === 'done') return { status: 'form', page, scan, frames }
      if (choice?.action === 'click' && choice.key) next = scan.buttons.find((b) => b.key === choice.key)
      if (choice?.action === 'closed') return { status: 'closed', page, reason: choice.reason }
      // EURES and small boards write "apply via jobs@firm.com" or the careers URL as plain text.
      const email = choice?.action === 'email' ? /[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[a-z]{2,}/i.exec(choice.email ?? '')?.[0] : undefined
      if (email && scan.textSample.toLowerCase().includes(email.toLowerCase())) return { status: 'email', page, email, reason: choice!.reason }
      const url = choice?.action === 'open' ? /^https?:\/\/\S+$/i.exec((choice.url ?? '').trim())?.[0] : undefined
      if (url && !tried.has(`open|${url}`) && !isBlockedHost(url, opts.allowLinkedIn)) {
        tried.add(`open|${url}`)
        opts.log(`opening the application link from the text (${hostOf(url)})`)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
        await settle(page, 1200)
        continue
      }
      if (choice?.action === 'human' || choice?.action === 'open' || choice?.action === 'email') return { status: 'notfound', page, reason: choice.reason }
    }
    if (!next) return { status: 'notfound', page, reason: `No application form or Apply button found on ${hostOf(page.url())}` }
    tried.add(`${page.url()}|${next.text}|${next.href}`)
    pressCount.set(`${pageKey}|${next.text}`, (pressCount.get(`${pageKey}|${next.text}`) ?? 0) + 1)
    opts.log(`click "${next.text}"${next.href ? ` (${hostOf(next.href)})` : ''}`)
    const before = page.url()
    const nextPage = await clickAndFollow(page, frames, next).catch((err: unknown) => {
      opts.log(`click failed: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
      return page
    })
    if (nextPage !== page) {
      // The flow moved to a new tab; close the posting tab so tabs do not pile up.
      await page.close().catch(() => undefined)
      page = nextPage
    } else {
      // A link whose click goes nowhere, or only adds a #hash (Xero's "Apply Now" to Ashby, onetrace's
      // "Apply for this role", both clicked six times): open its address.
      const bare = (u: string) => u.split(/[?#]/)[0].replace(/\/$/, '')
      if (page.url() === before) await page.waitForTimeout(800)
      if (bare(page.url()) === bare(before) && /^https?:\/\//i.test(next.href) && bare(next.href) !== bare(before) && !isBlockedHost(next.href, opts.allowLinkedIn)) {
        opts.log(`the click did not move; opening ${hostOf(next.href)} directly`)
        await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
        await settle(page, 1200)
      }
    }
  }
  return { status: 'notfound', page, reason: 'Gave up after several pages without reaching the form' }
}

async function askWhereToGo(scan: PageScan, job: { title: string; company: string }, onAiCall?: () => void) {
  const options = scan.buttons
    .filter((b) => !b.disabled)
    .slice(0, 50)
    .map((b) => ({ key: b.key, text: b.text, kind: b.kind, host: hostOf(b.href) || undefined }))
  onAiCall?.()
  const r = await generateJson({
    task: 'portal_nav',
    model: 'lite',
    schema: navDecisionSchema,
    temperature: 0,
    maxOutputTokens: 600,
    system:
      'You help a job applicant reach the online application form. Given a page and its buttons/links, choose the one that leads to the application form for the job (Apply, Bewerben, Postuler...) and answer click with its key. Never choose LinkedIn, Indeed, Xing, social sharing, job alerts or "similar jobs". If the page itself is the application form, answer done. If no button fits but the text gives the application or careers URL, answer open with that exact URL. If the text says to apply by email, answer email with the exact address from the text. If the text says the job is filled, closed or expired, answer closed. If only a login with an existing account or nothing useful is available, answer human. Answer ONLY with JSON.',
    prompt: `Job: ${job.title} at ${job.company}\nPage: ${scan.title} (${scan.url})\nHeadings: ${scan.headings.slice(0, 6).join(' | ')}\nText: ${scan.textSample.slice(0, 3500)}\n\nButtons and links (JSON): ${JSON.stringify(options)}`,
  })
  return r.data
}
