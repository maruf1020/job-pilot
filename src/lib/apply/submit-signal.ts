import type { Page, Request, Response } from 'playwright'

/**
 * The site's own answer to Submit, read from the network: more certain than any page text. Recruitee
 * (also the careers sites it runs, such as careers.anywhere.now) posts the form to /candidates and answers
 * 201 when the application is in, 422 with field errors, and 429 when this email already applied
 * ("offer_limit") or applied to another role there (read from its public app bundle). On
 * success it clears the form in place, so the page alone looks like an empty form again.
 */

export type SubmitOutcome = 'sent' | 'already' | 'company_limit' | 'rejected'
/** `detail`: the site's own error text for a rejected form ("phone is invalid", "captcha"), so the reason is known, not guessed. */
export type SubmitSignal = { outcome: SubmitOutcome; status: number; url: string; site: string; detail?: string | null }

const ENDPOINTS: Array<{ site: string; path: RegExp }> = [{ site: 'recruitee', path: /^\/(?:l\/[a-z]{2}(?:-[a-z]{2})?\/)?candidates\/?$|\/api\/offers\/[^/]+\/candidates\/?$/i }]

/** Posts that are never the application: analytics, error reports, CAPTCHA traffic. */
const NOISE = /analytics|sentry|track|telemetry|metrics|beacon|collect|\/events?\b|\blogs?\b|captcha|turnstile|challenge|recaptcha|segment|hotjar|clarity|datadog|newrelic|mixpanel|amplitude|intercom|cookie|consent/i
const ATS_HOST = /greenhouse|lever\.co|ashbyhq|workable|recruitee|teamtailor|personio|smartrecruiters|myworkdayjobs|bamboohr|jobvite|icims|join\.com|breezy|pinpoint|homerun|jazzhr|comeet|dover|rippling|successfactors|sapsf|taleo|oraclecloud|zohorecruit/i

/** Which known submit endpoint a request is, if any. */
export function submitEndpoint(method: string, url: string): string | null {
  if (method.toUpperCase() !== 'POST') return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  return ENDPOINTS.find((e) => e.path.test(u.pathname))?.site ?? null
}

/** The registrable part of a host, roughly (careers.anywhere.now → anywhere.now). */
function siteOf(host: string): string {
  return host.split('.').slice(-2).join('.')
}

/**
 * A post that may be the form going out: on the page's own site or an applicant system, by script or as
 * a page load, and not analytics or CAPTCHA traffic. While one is on its way the site is still sending.
 */
export function isFormPost(method: string, url: string, resourceType: string, pageUrl: string): boolean {
  if (method.toUpperCase() !== 'POST' || !['xhr', 'fetch', 'document'].includes(resourceType)) return false
  if (submitEndpoint(method, url)) return true
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (NOISE.test(u.hostname) || NOISE.test(u.pathname)) return false
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname
  } catch {
    // about:blank and the like: only applicant systems count.
  }
  return (!!pageHost && siteOf(u.hostname) === siteOf(pageHost)) || ATS_HOST.test(u.hostname)
}

/** What the site's answer means, from its status (and, for 429, the reason in its body). */
export function classifyAnswer(status: number, reason?: string | null): SubmitOutcome | null {
  if (status === 200 || status === 201) return 'sent'
  if (status === 429) return !reason || reason === 'offer_limit' ? 'already' : 'company_limit'
  if (status === 400 || status === 422) return 'rejected'
  return null
}

export function describeSignal(s: SubmitSignal): string {
  const what = { sent: 'accepted the application', already: 'says this job was already applied to', company_limit: 'takes one application per person and already has one for another role', rejected: 'rejected the form with errors' }[s.outcome]
  return `${s.site === 'recruitee' ? 'Recruitee' : s.site} ${what} (HTTP ${s.status} from ${new URL(s.url).pathname})${s.detail ? `: ${s.detail}` : ''}`
}

/**
 * The error text of a rejected form, short and readable: Recruitee answers 422 with JSON such as
 * {"errors":{"phone":["is invalid"]}} or {"error":"..."}. When only the status was kept,
 * and Delta Capita and DPG Media failed with "Something went wrong" even when filled by hand.
 */
export function rejectionDetail(body: string): string | null {
  const text = body.trim()
  if (!text) return null
  try {
    const j = JSON.parse(text) as { errors?: unknown; error?: unknown; message?: unknown }
    const errs = j.errors ?? j.error ?? j.message
    if (typeof errs === 'string') return errs.slice(0, 300)
    if (Array.isArray(errs)) return errs.map(String).join('; ').slice(0, 300)
    if (errs && typeof errs === 'object') {
      return Object.entries(errs as Record<string, unknown>)
        .map(([field, v]) => `${field} ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('; ')
        .slice(0, 300)
    }
  } catch {
    // Not JSON: an HTML error page or plain text.
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null
}

async function readSignal(res: Response, site: string): Promise<SubmitSignal | null> {
  const status = res.status()
  let reason: string | null = null
  let detail: string | null = null
  if (status === 429) reason = await res.json().then((b: { reason?: string } | null) => b?.reason ?? null, () => null)
  if (status === 400 || status === 422) detail = await res.text().then(rejectionDetail, () => null)
  const outcome = classifyAnswer(status, reason)
  return outcome ? { outcome, status, url: res.url(), site, detail } : null
}

/**
 * Follow the form posts of a tab: `onStart`/`onEnd` while one is on its way, `onSignal` when a known
 * submit endpoint answers. Returns the function that stops listening.
 */
export function watchSubmits(page: Page, on: { onStart?: () => void; onEnd?: () => void; onSignal: (s: SubmitSignal) => void }): () => void {
  const pending = new Set<Request>()
  const start = (req: Request) => {
    if (!isFormPost(req.method(), req.url(), req.resourceType(), page.url())) return
    pending.add(req)
    on.onStart?.()
  }
  const end = (req: Request) => {
    if (pending.delete(req)) on.onEnd?.()
  }
  const response = (res: Response) => {
    const req = res.request()
    const site = submitEndpoint(req.method(), req.url())
    if (site) void readSignal(res, site).then((s) => s && on.onSignal(s), () => undefined)
  }
  page.on('request', start)
  page.on('requestfinished', end)
  page.on('requestfailed', end)
  page.on('response', response)
  return () => {
    page.off('request', start)
    page.off('requestfinished', end)
    page.off('requestfailed', end)
    page.off('response', response)
    pending.forEach(() => on.onEnd?.())
    pending.clear()
  }
}
