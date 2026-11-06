import { promises as dns } from 'node:dns'
import { z } from 'zod'
import { generateJson, generateText, GroundingQuotaError } from '@/lib/ai/gemini'
import { pacificDate } from '@/lib/ai/key-pool'
import { db } from '@/lib/db'
import { autoSendRecipientProblem, isUsableContact } from '@/lib/email/address'
import { suppressAddress, suppressedReason, withoutSuppressed } from '@/lib/email/suppression'
import { verifyCandidates, verifyMailbox } from '@/lib/email/verify'
import { getServiceCredential } from '@/lib/keys/service-keys'
import { GOOGLE_CSE_DAILY_LIMIT, reserveApiCall } from '@/lib/quota'
import { extractEmails, htmlToText, truncate } from '@/lib/text'
import { titleAllowed } from '@/lib/ranking/rules'
import { getSettings } from '@/lib/settings/service'
import { mapLimit } from '@/lib/utils/semaphore'
import type { RunLogger } from './logger'

/**
 * Contact discovery: find somewhere to send an application when the posting has no
 * email. Strategies run per COMPANY (cached on the Company row, then applied to its
 * jobs), cheapest first:
 *
 *  1. an address already on the company or in one of its postings
 *  2. the company website: homepage → careers/jobs/contact/about/imprint pages,
 *     including obfuscated addresses ("jobs [at] acme [dot] ie", Cloudflare-protected
 *     mailto links, JSON-LD contact points)
 *  3. Gemini: web-search grounding (while its quota lasts), then a knowledge-only ask;
 *     when several candidates exist Gemini picks the one meant for applications
 *  4. Google Programmable Search when its keys are configured
 *  5. pattern guesses (careers@, jobs@ …) on the company domain when it accepts mail
 *
 * Every candidate that can be checked is verified against the company's mail server
 * (RCPT TO, nothing is sent): a confirmed mailbox is `verified`, a rejected one is
 * dropped, catch-all domains keep the best candidate as `guessed`.
 */

export type ContactSource = 'posting' | 'company' | 'website' | 'search' | 'verified' | 'guessed' | 'manual'

const AGGREGATOR_HOSTS =
  /(arbeitnow|jooble|adzuna|linkedin|indeed|glassdoor|stepstone|xing|monster|jobs\.ie|irishjobs|remotive|remoteok|greenhouse|lever\.co|ashbyhq|workable|smartrecruiters|myworkdayjobs|workday|personio|teamtailor|recruitee|bamboohr|join\.com|themuse|jobicy|himalayas|landing\.jobs|workingnomads|europa\.eu|eures|jobgether|reed\.co\.uk|francetravail|jobvite|icims|successfactors|taleo|rapidapi|google|facebook|twitter|x\.com|welcometothejungle|euremotejobs|jobglance|comeet|breezy|pinpointhq|dover|rippling|homerun|wellfound|otta|honeypot|instahyre)/i

const FREE_MAIL = /(gmail|yahoo|hotmail|outlook|live|icloud|proton|gmx|web\.de|mail\.com|yandex)\./i

/** Ten guesses at most; after all bounce, the job goes back to manual handling. */
export const GUESS_LOCAL_PARTS = ['careers', 'jobs', 'recruiting', 'recruitment', 'hr', 'talent', 'hiring', 'people', 'hello', 'info']
export const MAX_GUESSES = 10
/** Bounces before the job goes to manual handling: Licorne got six guessed addresses that all bounced, and each bounce hurts the sender score. */
export const MAX_BOUNCE_RETRIES = 3


const SITE_TIMEOUT_MS = 6000
const MAX_CRAWL_PAGES = 8
const LINK_HINT = /(career|job|vacanc|join|work-with|working-at|contact|about|team|impressum|imprint|legal|recruit|hiring|people|kontakt|uber-uns|ueber-uns|carriere|empleo|lavora)/i

/** Pacific date on which Google Search grounding ran out; skipped for the rest of that day. */
let groundingDisabledOn: string | null = null

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function hostToDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** The company's own domain, if we can tell it apart from job boards and ATS hosts. */
export function domainForJob(job: { url: string; contactEmail?: string | null }, company: { domain?: string | null; careersUrl?: string | null }): string | null {
  if (company.domain) return hostToDomain(company.domain.replace(/^https?:\/\//, '').split('/')[0])
  if (company.careersUrl) {
    try {
      const h = hostToDomain(new URL(company.careersUrl).hostname)
      if (!AGGREGATOR_HOSTS.test(h)) return h
    } catch {
      /* ignore */
    }
  }
  if (job.contactEmail && !FREE_MAIL.test(job.contactEmail)) return job.contactEmail.split('@')[1]?.toLowerCase() ?? null
  try {
    const h = hostToDomain(new URL(job.url).hostname)
    if (!AGGREGATOR_HOSTS.test(h)) return h
  } catch {
    /* ignore */
  }
  return null
}

const mxCache = new Map<string, boolean>()

export async function hasMailRecords(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain)
  if (cached !== undefined) return cached
  let ok = false
  try {
    const mx = await dns.resolveMx(domain)
    ok = mx.length > 0
  } catch {
    ok = false
  }
  mxCache.set(domain, ok)
  return ok
}

function sameCompany(email: string, domain: string | null): boolean {
  const d = email.split('@')[1]?.toLowerCase() ?? ''
  if (!domain) return !FREE_MAIL.test(d)
  return d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)
}

export { isUsableContact }

function scoreEmail(e: string, domain: string): number {
  const [local, d] = e.split('@')
  let s = 0
  if (domain && (d === domain || d.endsWith(`.${domain}`))) s += 10
  if (/^(careers|jobs|recruit|recruiting|recruitment|talent|hiring|hr|people|apply|bewerbung|jobs-)/.test(local)) s += 6
  if (/^(hello|contact|info|office|kontakt|mail|team)/.test(local)) s += 2
  if (FREE_MAIL.test(d)) s -= 3
  return s
}

function rankEmails(emails: string[], domain: string): string[] {
  return [...new Set(emails)].sort((a, b) => scoreEmail(b, domain) - scoreEmail(a, domain))
}

// ---------------------------------------------------------------------------
// Obfuscated address decoding
// ---------------------------------------------------------------------------

/** Cloudflare "email-protection": first byte is the XOR key for the rest. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return null
  const key = Number.parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key)
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out.toLowerCase() : null
}

/**
 * "jobs [at] acme [dot] ie", "jobs (at) acme.ie", "jobs at acme dot ie", "jobs@acme[.]ie",
 * HTML entity forms (&#64;, &commat;) and Cloudflare-protected links.
 */
export function decodeObfuscatedEmails(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const e = decodeCloudflareEmail(m[1])
    if (e) out.add(e)
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const e = decodeCloudflareEmail(m[1])
    if (e) out.add(e)
  }
  const text = html
    .replace(/&#64;|&commat;|&#x40;/gi, '@')
    .replace(/&#46;|&period;/gi, '.')
    .replace(/<[^>]+>/g, ' ')
  const at = String.raw`(?:@|\s*[\[\(\{]\s*at\s*[\]\)\}]\s*|\s+at\s+)`
  const dot = String.raw`(?:\.|\s*[\[\(\{]\s*(?:dot|punkt)\s*[\]\)\}]\s*|\s+dot\s+)`
  const re = new RegExp(String.raw`([a-z0-9._%+-]{1,64})${at}([a-z0-9-]+(?:${dot}[a-z0-9-]+)+)`, 'gi')
  for (const m of text.matchAll(re)) {
    const local = m[1].toLowerCase()
    const domain = m[2]
      .toLowerCase()
      .replace(/\s*[\[\(\{]\s*(?:dot|punkt)\s*[\]\)\}]\s*|\s+dot\s+/g, '.')
      .replace(/\.+/g, '.')
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain)) continue
    // plain "a at b" prose is noisy: only keep spaced forms when the domain clearly has a TLD and the local part looks like a mailbox
    if (/\s/.test(m[0]) && !/^(careers|jobs|recruit|recruiting|recruitment|talent|hiring|hr|people|hello|contact|info|apply|office|team|bewerbung|kontakt)/.test(local)) continue
    out.add(`${local}@${domain}`)
  }
  return [...out]
}

/** Emails declared in JSON-LD (Organization.contactPoint / email fields). */
export function extractJsonLdEmails(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const e of extractEmails(m[1].replace(/\\u0040/g, '@').replace(/mailto:/gi, ''))) out.add(e)
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Website crawl
// ---------------------------------------------------------------------------

export interface Candidate {
  email: string
  page: string
  snippet: string
}

interface FetchedPage {
  html: string
  finalUrl: string
}

type PageGetter = (url: string) => Promise<FetchedPage | null>

/** Statuses that mean "a bot gate, try a real browser" rather than "page does not exist". */
const BLOCKED_STATUSES = new Set([401, 403, 429, 503])

async function fetchHtml(url: string, fetchImpl: typeof fetch, timeoutMs = SITE_TIMEOUT_MS): Promise<{ page: FetchedPage | null; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 job-pilot', accept: 'text/html,*/*', 'accept-language': 'en-IE,en;q=0.9' },
      redirect: 'follow',
    })
    if (!res.ok) return { page: null, status: res.status }
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return { page: null, status: res.status }
    return { page: { html: (await res.text()).slice(0, 800_000), finalUrl: res.url || url }, status: res.status }
  } catch {
    return { page: null, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

function snippetAround(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return ''
  return text.slice(Math.max(0, i - 70), i + needle.length + 70).replace(/\s+/g, ' ').trim()
}

function candidatesFromPage(html: string, page: string): Candidate[] {
  const text = htmlToText(html)
  const mailtos = [...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1])
  const found = new Set<string>([...extractEmails(mailtos.join(' ')), ...extractEmails(text), ...decodeObfuscatedEmails(html), ...extractJsonLdEmails(html)])
  return [...found].filter(isUsableContact).map((email) => ({ email, page, snippet: snippetAround(text, email.split('@')[0]) }))
}

function discoverInternalLinks(html: string, base: URL, domain: string): string[] {
  const links = new Map<string, number>()
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL
    try {
      u = new URL(m[1], base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(u.protocol)) continue
    const h = hostToDomain(u.hostname)
    if (h !== domain && !h.endsWith(`.${domain}`)) continue
    const label = `${u.pathname} ${m[2].replace(/<[^>]+>/g, ' ')}`
    const hint = LINK_HINT.exec(label)
    if (!hint) continue
    const weight = /career|job|vacanc|recruit|hiring|bewerb/i.test(label) ? 3 : /contact|kontakt|impressum|imprint/i.test(label) ? 2 : 1
    u.hash = ''
    u.search = ''
    const key = u.toString()
    links.set(key, Math.max(links.get(key) ?? 0, weight))
  }
  return [...links.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u)
}

export interface CrawlResult {
  candidates: Candidate[]
  pages: number
  /** true when the site refused plain HTTP and a headless browser was used instead */
  viaBrowser: boolean
}

/** The crawl itself, independent of how pages are loaded (plain fetch or a browser). */
async function crawlWith(domain: string, getPage: PageGetter, homepage: FetchedPage, concurrency: number, maxPages = MAX_CRAWL_PAGES): Promise<{ candidates: Candidate[]; pages: number }> {
  const visited = new Set<string>([homepage.finalUrl])
  const candidates: Candidate[] = candidatesFromPage(homepage.html, homepage.finalUrl)
  const base = new URL(homepage.finalUrl)
  const queue = [...discoverInternalLinks(homepage.html, base, domain), ...['/careers', '/jobs', '/contact', '/impressum', '/imprint', '/about'].map((p) => new URL(p, base).toString())].filter(
    (u, i, arr) => arr.indexOf(u) === i && !visited.has(u),
  )
  await mapLimit(queue.slice(0, maxPages), concurrency, async (url) => {
    if (visited.has(url)) return
    visited.add(url)
    const page = await getPage(url)
    if (!page) return
    candidates.push(...candidatesFromPage(page.html, page.finalUrl))
  })
  return { candidates, pages: visited.size }
}

/**
 * Crawl the company's own site for addresses. Homepage first, then linked
 * careers/contact/about/imprint pages, then a few well-known paths. Sites that
 * answer with a bot check (403/429…) are crawled again with a headless browser.
 */
export async function crawlWebsiteForEmails(domain: string, fetchImpl: typeof fetch = globalThis.fetch, log?: RunLogger, opts: { browser?: boolean; maxPages?: number } = {}): Promise<CrawlResult> {
  let homepage: FetchedPage | null = null
  let blocked = false
  for (const scheme of ['https', 'http']) {
    const r = await fetchHtml(`${scheme}://${domain}/`, fetchImpl)
    if (r.page) {
      homepage = r.page
      break
    }
    if (BLOCKED_STATUSES.has(r.status)) blocked = true
  }
  if (homepage) {
    const r = await crawlWith(domain, (u) => fetchHtml(u, fetchImpl).then((x) => x.page), homepage, 3, opts.maxPages)
    log?.debug(`crawl ${domain}: ${r.pages} pages, ${r.candidates.length} candidate(s)`)
    return { ...r, viaBrowser: false }
  }
  if (!blocked || opts.browser === false) return { candidates: [], pages: 0, viaBrowser: false }

  // Bot-gated site: open a real browser (Playwright) and read the same pages.
  try {
    const { withBrowserReader } = await import('@/lib/sources/scrape')
    const r = await withBrowserReader(
      async (read) => {
        const home = await read(`https://${domain}/`)
        if (!home) return { candidates: [], pages: 0 }
        return crawlWith(domain, read, home, 1, opts.maxPages)
      },
      { log: (m) => log?.debug(m) },
    )
    log?.debug(`browser crawl ${domain}: ${r.pages} pages, ${r.candidates.length} candidate(s)`)
    return { ...r, viaBrowser: true }
  } catch (err) {
    log?.debug(`browser crawl unavailable for ${domain}: ${err instanceof Error ? err.message : err}`)
    return { candidates: [], pages: 0, viaBrowser: false }
  }
}

/** Older callers: just the ranked list from a crawl. */
export async function findEmailsOnWebsite(domain: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string[]> {
  const { candidates } = await crawlWebsiteForEmails(domain, fetchImpl)
  return rankEmails(candidates.map((c) => c.email), domain)
}

// ---------------------------------------------------------------------------
// Gemini and Google helpers
// ---------------------------------------------------------------------------

const pickSchema = z.object({
  email: z.string().nullable().describe('The best address for sending a job application, or null if none fits'),
  reason: z.string().max(200),
})

/** Several candidates: let Gemini (lite) pick the one meant for applications, with the page snippets as evidence. */
export async function chooseBestEmail(company: string, domain: string | null, candidates: Candidate[], log?: RunLogger): Promise<string | null> {
  const ranked = rankEmails(candidates.map((c) => c.email), domain ?? '')
  if (ranked.length <= 1) return ranked[0] ?? null
  const top = ranked[0]
  if (/^(careers|jobs|recruiting|recruitment|talent|hiring|bewerbung|apply)/.test(top.split('@')[0])) return top
  try {
    const r = await generateJson({
      task: 'enrich',
      model: 'lite',
      schema: pickSchema,
      temperature: 0,
      maxOutputTokens: 400,
      system: 'You choose which email address a job candidate should use to send an application to a company. Prefer careers/recruiting/HR/jobs mailboxes, then a general contact address on the company domain. Never choose press, privacy, support, sales or legal mailboxes. Answer ONLY with JSON.',
      prompt: `Company: ${company}${domain ? ` (${domain})` : ''}\nCandidates:\n${ranked
        .slice(0, 12)
        .map((e) => {
          const c = candidates.find((x) => x.email === e)
          return `- ${e}${c?.snippet ? ` — "${truncate(c.snippet, 140)}" (${c.page})` : ''}`
        })
        .join('\n')}`,
    })
    const chosen = r.data.email?.toLowerCase()
    if (chosen && ranked.includes(chosen)) return chosen
  } catch (err) {
    log?.debug(`pick failed for ${company}: ${err instanceof Error ? err.message : err}`)
  }
  return top
}

/** Gemini with Google Search grounding: only trusted when the answer sits on the company domain. */
export async function searchEmailWithGemini(company: string, domain: string | null, jobTitle: string, log?: RunLogger): Promise<string | null> {
  if (groundingDisabledOn === pacificDate()) return null
  try {
    const r = await generateText({
      task: 'enrich',
      model: 'lite',
      webSearch: true,
      temperature: 0,
      maxOutputTokens: 400,
      system: 'You look up official company contact addresses using web search. Answer with the single best email address for sending a job application (careers/recruiting/HR/jobs address, or a general contact address if that is all the company publishes). Only report an address you actually saw on a web page. If you cannot find one, answer exactly NONE.',
      prompt: `Company: ${company}${domain ? ` (website ${domain})` : ''}. Role: ${jobTitle}. Which email address should a candidate use to apply or ask about this job?`,
    })
    const emails = extractEmails(r.text).filter((e) => sameCompany(e, domain) && isUsableContact(e))
    const ranked = rankEmails(emails, domain ?? '')
    log?.debug(`gemini search for ${company}: ${ranked[0] ?? 'none'}`)
    return ranked[0] ?? null
  } catch (err) {
    if (err instanceof GroundingQuotaError) {
      groundingDisabledOn = pacificDate()
      log?.warn('Google Search grounding quota used up for today; contact discovery continues with website lookup, model knowledge and guesses')
      return null
    }
    log?.debug(`gemini search failed for ${company}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Gemini without tools: what it already knows. Treated as a guess until the mailbox verifies. */
export async function askGeminiKnowledge(company: string, domain: string | null, log?: RunLogger): Promise<string | null> {
  try {
    const r = await generateText({
      task: 'enrich',
      model: 'lite',
      temperature: 0,
      maxOutputTokens: 200,
      system: 'You recall publicly known recruiting or careers email addresses of companies. Answer with one email address on the company\'s own domain, or exactly NONE if you are not confident. No explanation.',
      prompt: `Company: ${company}${domain ? ` (website ${domain})` : ''}. What email address do they publish for job applications or recruiting?`,
    })
    const emails = extractEmails(r.text).filter((e) => sameCompany(e, domain) && isUsableContact(e))
    return rankEmails(emails, domain ?? '')[0] ?? null
  } catch (err) {
    log?.debug(`gemini knowledge failed for ${company}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

const domainSchema = z.object({
  domain: z.string().nullable().describe('The company website domain, e.g. "acme.ie", or null if unsure'),
})

/**
 * Company with no known website: ask Gemini for the domain, then check it is real
 * (not a job board, receives mail, and its homepage mentions the company).
 */
export async function findCompanyDomain(company: string, jobTitle: string, fetchImpl: typeof fetch = globalThis.fetch, log?: RunLogger): Promise<string | null> {
  let candidate: string | null = null
  try {
    const r = await generateJson({
      task: 'enrich',
      model: 'lite',
      schema: domainSchema,
      temperature: 0,
      maxOutputTokens: 200,
      system: 'You identify the official website domain of an employer. Answer ONLY with JSON {"domain": "example.com"} using the bare domain (no scheme, no path). Never answer with a job board, ATS or social network domain. If you are not confident, answer {"domain": null}.',
      prompt: `Employer: ${company}\nThey are hiring for: ${jobTitle}\nWhat is their website domain?`,
    })
    candidate = r.data.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? null
  } catch (err) {
    log?.debug(`domain lookup failed for ${company}: ${err instanceof Error ? err.message : err}`)
    return null
  }
  if (!candidate || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(candidate) || AGGREGATOR_HOSTS.test(candidate) || FREE_MAIL.test(`${candidate}.`)) return null
  if (!(await hasMailRecords(candidate))) return null
  // The homepage must mention the company (a distinctive word of its name) so a look-alike domain is not accepted.
  const words = company
    .toLowerCase()
    .replace(/\b(gmbh|ltd|limited|inc|llc|plc|bv|b\.v\.|ag|sa|sas|srl|oy|ab|as|the|group|technologies|technology|software|labs|solutions)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
  const { page } = await fetchHtml(`https://${candidate}/`, fetchImpl)
  if (page) {
    const text = `${page.finalUrl} ${htmlToText(page.html).slice(0, 20_000)}`.toLowerCase()
    if (words.length && !words.some((w) => text.includes(w)) && !candidate.includes(words[0].slice(0, 5))) return null
  } else if (words.length && !words.some((w) => candidate.includes(w.slice(0, 5)))) {
    // Could not load the site (bot gate?): accept only when the domain itself resembles the name.
    return null
  }
  log?.debug(`domain for ${company}: ${candidate}`)
  return candidate
}

/** Google Programmable Search (optional, needs GOOGLE_CSE_KEY + GOOGLE_CSE_CX). */
export async function searchEmailWithGoogle(company: string, domain: string | null, fetchImpl: typeof fetch = globalThis.fetch, log?: RunLogger): Promise<string | null> {
  const cse = await getServiceCredential('google_cse')
  if (!cse) return null
  const queries = [domain ? `site:${domain} careers email` : `"${company}" careers email`, `"${company}" jobs application email ${domain ? `@${domain}` : ''}`]
  const found: string[] = []
  for (const q of queries) {
    // Hard rule: never more than GOOGLE_CSE_DAILY_LIMIT calls a day, counted in the database.
    if (!(await reserveApiCall('google_cse'))) {
      log?.warn(`Google search: daily cap of ${GOOGLE_CSE_DAILY_LIMIT} calls reached; skipping until tomorrow`)
      return null
    }
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(cse.GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(cse.GOOGLE_CSE_CX)}&num=5&q=${encodeURIComponent(q)}`
      const res = await fetchImpl(url)
      if (!res.ok) continue
      const data = (await res.json()) as { items?: Array<{ title?: string; snippet?: string; link?: string }> }
      for (const it of data.items ?? []) {
        found.push(...extractEmails(`${it.title ?? ''} ${it.snippet ?? ''}`))
        if (it.link && domain && it.link.includes(domain) && found.length === 0) {
          const { page } = await fetchHtml(it.link, fetchImpl)
          if (page) found.push(...candidatesFromPage(page.html, page.finalUrl).map((c) => c.email))
        }
      }
      const ranked = rankEmails(found.filter((e) => sameCompany(e, domain) && isUsableContact(e)), domain ?? '')
      if (ranked.length) return ranked[0]
    } catch (err) {
      log?.debug(`google search failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Company-level discovery
// ---------------------------------------------------------------------------

export interface ContactResult {
  email: string | null
  source: ContactSource | null
  candidates: string[]
  domain: string | null
  notes: string[]
  jobsUpdated: number
}

export interface DiscoverOptions {
  fetchImpl?: typeof fetch
  log?: RunLogger
  /** Re-run even if the company was checked before. */
  force?: boolean
  /** Skip SMTP verification (faster; everything found stays unverified). */
  skipVerify?: boolean
  /** Allow the headless-browser fallback for bot-gated sites (default true). */
  browser?: boolean
  /** Pages to crawl beyond the homepage (default 8; smaller on serverless). */
  maxPages?: number
  /** A job title that helps the web search. */
  jobTitle?: string
}

/** Apply the company's address to its jobs that have none (postings with their own address are left alone). */
async function applyToJobs(companyId: string, email: string | null, source: ContactSource | null, candidates: string[]): Promise<number> {
  if (!email) {
    await db.job.updateMany({ where: { companyId, contactEmail: null }, data: { contactCheckedAt: new Date() } })
    return 0
  }
  const r = await db.job.updateMany({
    where: { companyId, contactEmail: null },
    data: { contactEmail: email, contactEmailSource: source, contactCandidates: candidates, contactCheckedAt: new Date(), applyChannel: 'email' },
  })
  return r.count
}

/**
 * Find (and verify) an application address for a company, cache it on the
 * Company row and copy it onto its jobs. Returns what was found and why.
 */
export async function discoverContactForCompany(companyId: string, opts: DiscoverOptions = {}): Promise<ContactResult> {
  const company = await db.company.findUnique({ where: { id: companyId }, include: { jobs: { select: { url: true, contactEmail: true, contactEmailSource: true, title: true }, take: 25 } } })
  if (!company) throw new Error('Company not found')
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const log = opts.log
  const notes: string[] = []

  if (company.contactEmail && !opts.force) {
    const jobsUpdated = await applyToJobs(company.id, company.contactEmail, (company.contactEmailSource as ContactSource) ?? 'company', company.contactCandidates)
    return { email: company.contactEmail, source: (company.contactEmailSource as ContactSource) ?? 'company', candidates: company.contactCandidates, domain: company.domain, notes: ['cached'], jobsUpdated }
  }

  // 1. An address one of the postings already carries
  const fromPosting = company.jobs.find((j) => j.contactEmail && (j.contactEmailSource === 'posting' || j.contactEmailSource === 'manual' || !j.contactEmailSource))?.contactEmail ?? null
  const jobTitle = opts.jobTitle ?? company.jobs[0]?.title ?? 'Software Engineer'
  let domain = company.jobs.reduce<string | null>((acc, j) => acc ?? domainForJob(j, company), null) ?? (company.domain ? hostToDomain(company.domain) : null)
  if (!domain) {
    domain = await findCompanyDomain(company.name, jobTitle, fetchImpl, log)
    notes.push(domain ? `website found: ${domain}` : 'company website unknown')
  }

  let email: string | null = null
  let source: ContactSource | null = null
  let candidates: string[] = []

  if (fromPosting && isUsableContact(fromPosting)) {
    email = fromPosting
    source = 'posting'
    notes.push('address taken from a posting')
  }

  // 2. Website crawl
  let crawled: Candidate[] = []
  if (!email && domain) {
    const crawl = await crawlWebsiteForEmails(domain, fetchImpl, log, { browser: opts.browser, maxPages: opts.maxPages })
    crawled = crawl.candidates.filter((c) => sameCompany(c.email, domain) || !crawl.candidates.some((x) => sameCompany(x.email, domain)))
    notes.push(`crawled ${crawl.pages} page(s) on ${domain}${crawl.viaBrowser ? ' with a browser (site blocks plain requests)' : ''}, ${crawled.length} candidate(s)`)
    if (crawled.length) {
      email = await chooseBestEmail(company.name, domain, crawled, log)
      source = 'website'
      candidates = rankEmails(crawled.map((c) => c.email), domain).filter((e) => e !== email).slice(0, 4)
    }
  }

  // 3./4. Web search and model knowledge
  if (!email) {
    const viaGemini = await searchEmailWithGemini(company.name, domain, jobTitle, log)
    const viaGoogle = viaGemini ? null : await searchEmailWithGoogle(company.name, domain, fetchImpl, log)
    const hit = viaGemini ?? viaGoogle
    if (hit) {
      email = hit
      source = 'search'
      notes.push(`found by ${viaGemini ? 'Gemini web search' : 'Google search'}`)
    } else {
      const known = await askGeminiKnowledge(company.name, domain, log)
      if (known) {
        // Model memory is only a lead: it must verify or it is treated like a guess.
        candidates = [known]
        notes.push(`model suggested ${known}`)
      }
    }
  }

  // 5. Pattern guesses on the company domain
  if (!email && domain && (await hasMailRecords(domain))) {
    const guesses = GUESS_LOCAL_PARTS.slice(0, MAX_GUESSES).map((l) => `${l}@${domain}`)
    candidates = [...new Set([...candidates, ...guesses])]
    source = 'guessed'
    notes.push('no published address; using pattern guesses')
  } else if (!email && domain) {
    notes.push(`${domain} has no mail records`)
  } else if (!email && !domain) {
    notes.push('company domain unknown (set it on the company to enable lookup)')
  }

  // Verification: confirm found addresses; pick the first guess the server accepts.
  if (!opts.skipVerify) {
    if (email) {
      const v = await verifyMailbox(email)
      notes.push(`${email}: ${v.outcome} (${v.detail})`)
      if (v.outcome === 'valid') source = 'verified'
      else if (v.outcome === 'invalid') {
        // The published address is dead: fall back to the next candidate or guesses.
        const rest = candidates.length ? candidates : domain && (await hasMailRecords(domain)) ? GUESS_LOCAL_PARTS.slice(0, MAX_GUESSES).map((l) => `${l}@${domain}`) : []
        email = null
        source = null
        candidates = rest
      }
    }
    if (!email && candidates.length) {
      const r = await verifyCandidates(candidates, 6)
      notes.push(...r.details)
      if (r.valid) {
        email = r.valid
        source = 'verified'
        candidates = candidates.filter((c) => c !== r.valid && !r.invalid.includes(c))
      } else {
        const remaining = candidates.filter((c) => !r.invalid.includes(c))
        if (remaining.length && (r.catchAll || r.unknown)) {
          email = remaining[0]
          source = 'guessed'
          candidates = remaining.slice(1)
          if (r.catchAll) notes.push('catch-all domain: guesses cannot be verified')
        } else {
          email = null
          source = null
          candidates = []
          if (r.invalid.length) notes.push(`all ${r.invalid.length} candidate(s) rejected by the mail server`)
        }
      }
    }
  } else if (!email && candidates.length) {
    email = candidates[0]
    source = 'guessed'
    candidates = candidates.slice(1)
  }

  // Last gate: job-board, opt-out and other unusable mailboxes are never stored as a company address.
  candidates = await withoutSuppressed(candidates.filter((c) => isUsableContact(c)))
  if (email && (await suppressedReason(email))) {
    notes.push(`${email} rejected (bounced before)`)
    email = candidates.shift() ?? null
    source = email ? 'guessed' : null
  }
  if (email && !isUsableContact(email)) {
    notes.push(`${email} rejected (not an employer recruiting address)`)
    email = candidates.shift() ?? null
    source = email ? 'guessed' : null
  }

  await db.company.update({
    where: { id: company.id },
    data: {
      contactEmail: email,
      contactEmailSource: source,
      contactCandidates: candidates.slice(0, MAX_GUESSES),
      contactCheckedAt: new Date(),
      contactNotes: notes.join(' · ').slice(0, 1000),
      ...(domain && !company.domain ? { domain } : {}),
    },
  })
  const jobsUpdated = await applyToJobs(company.id, email, source, candidates.slice(0, MAX_GUESSES))
  log?.debug(`contact for ${company.name}: ${email ?? 'none'} (${source ?? 'not found'})`)
  return { email, source, candidates, domain, notes, jobsUpdated }
}

/** Per-job entry point (job page "Find contact"): runs the company lookup and applies it to this job. */
export async function discoverContactForJob(jobId: string, opts: DiscoverOptions = {}): Promise<ContactResult> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true, companyId: true, title: true, contactEmail: true, contactEmailSource: true, contactCandidates: true, contactCheckedAt: true } })
  if (!job) throw new Error('Job not found')
  if (job.contactEmail && !opts.force) {
    if (!job.contactEmailSource) await db.job.update({ where: { id: jobId }, data: { contactEmailSource: 'posting', contactCheckedAt: new Date() } })
    return { email: job.contactEmail, source: (job.contactEmailSource as ContactSource) ?? 'posting', candidates: job.contactCandidates, domain: null, notes: ['job already has an address'], jobsUpdated: 0 }
  }
  const r = await discoverContactForCompany(job.companyId, { ...opts, jobTitle: job.title, force: true })
  if (r.email) {
    await db.job.update({
      where: { id: jobId },
      data: { contactEmail: r.email, contactEmailSource: r.source, contactCandidates: r.candidates.slice(0, MAX_GUESSES), contactCheckedAt: new Date(), applyChannel: 'email' },
    })
  } else {
    await db.job.update({ where: { id: jobId }, data: { contactCheckedAt: new Date() } })
  }
  return r
}

/** Pipeline step: discover contacts for high-scoring jobs that have none yet (grouped by company). */
export async function discoverContacts(
  settings: { search: { contactDiscovery: boolean; contactDiscoveryLimit: number }; ranking: { draftThreshold: number } },
  log: RunLogger,
  shouldStop?: () => Promise<boolean>,
) {
  if (!settings.search.contactDiscovery || settings.search.contactDiscoveryLimit === 0) return { checked: 0, found: 0, guessed: 0 }
  const jobs = await db.job.findMany({
    where: { status: 'RANKED', contactEmail: null, contactCheckedAt: null, finalScore: { gte: settings.ranking.draftThreshold }, company: { blacklisted: false } },
    orderBy: { finalScore: 'desc' },
    take: settings.search.contactDiscoveryLimit,
    select: { id: true, companyId: true, title: true },
  })
  const byCompany = new Map<string, { title: string; jobIds: string[] }>()
  for (const j of jobs) {
    const e = byCompany.get(j.companyId)
    if (e) e.jobIds.push(j.id)
    else byCompany.set(j.companyId, { title: j.title, jobIds: [j.id] })
  }
  let found = 0
  let guessed = 0
  await mapLimit([...byCompany.entries()], 3, async ([companyId, info]) => {
    if (await shouldStop?.()) return
    try {
      const r = await discoverContactForCompany(companyId, { log, jobTitle: info.title })
      if (r.email) found++
      if (r.source === 'guessed') guessed++
    } catch (err) {
      log.warn(`Contact discovery failed for company ${companyId}: ${err instanceof Error ? err.message : err}`)
    }
  })
  log.info(`Contact discovery: ${jobs.length} job(s) across ${byCompany.size} companies, ${found} addresses (${guessed} guessed)`)
  return { checked: jobs.length, found, guessed }
}

/**
 * After a bounce: move to the next candidate address. System-sent applications are
 * re-queued automatically (up to MAX_BOUNCE_RETRIES bounces, and only titles the title rule allows); manual ones go back to Review.
 * When no candidates remain the application needs a human and the job falls back to the portal channel.
 */
export async function rotateContactAfterBounce(applicationId: string, nextSlot: (countryCode: string | null) => Promise<Date>): Promise<{ next: string | null; requeued: boolean; exhausted: boolean }> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { job: { select: { id: true, title: true, companyId: true, companyName: true, contactCandidates: true, contactEmail: true, countryCode: true, contactEmailSource: true, company: { select: { domain: true } } } } },
  })
  if (!app) return { next: null, requeued: false, exhausted: false }
  const bounceCount = app.bounceCount + 1
  // A bounced address is blocked for every job and company from now on.
  if (app.toEmail) await suppressAddress(app.toEmail, `bounced (${app.job.companyName})`, { applicationId })
  // Only addresses an automatic send may use (the company's own domain, a mailbox for applications):
  // never a Sentry key, a placeholder, another company's address or one that bounced before.
  const usable = await withoutSuppressed(
    app.job.contactCandidates.filter((c) => isUsableContact(c) && autoSendRecipientProblem(c, { name: app.job.companyName, domain: app.job.company.domain }, 'guessed') === null),
  )
  const [next, ...rest] = usable
  // The bounced address must not be reused by other jobs of this company.
  await db.company.updateMany({ where: { id: app.job.companyId, contactEmail: app.toEmail ?? undefined }, data: { contactEmail: next ?? null, contactCandidates: rest, contactEmailSource: next ? 'guessed' : null } })
  if (!next || bounceCount >= MAX_BOUNCE_RETRIES) {
    await db.job.update({ where: { id: app.job.id }, data: { contactEmail: null, contactCandidates: [], contactEmailSource: null, applyChannel: 'portal' } })
    await db.application.update({
      where: { id: applicationId },
      data: { status: 'NEEDS_HUMAN', bounceCount, channel: 'portal', sentAt: null, scheduledFor: null, followUpDueAt: null, lastActivityAt: new Date(), notes: `Bounced at ${app.toEmail}. No more addresses to try (${bounceCount} bounces); apply through the company site instead.` },
    })
    return { next: null, requeued: false, exhausted: true }
  }
  await db.job.update({ where: { id: app.job.id }, data: { contactEmail: next, contactCandidates: rest, contactEmailSource: 'guessed' } })
  // The title rule covers resends too: a bounced "Senior Backend Engineer" from before the rule waits in Review.
  const settings = await getSettings()
  // The next guess is resent on its own only when the company's mail server confirms the mailbox: blind
  // resends after a bounce added a second bounce per company (once 19 bounces in an hour).
  const confirmed = app.autoRetry ? (await verifyMailbox(next).catch(() => null))?.outcome === 'valid' : false
  const requeue = app.autoRetry && confirmed && titleAllowed(settings.portal, app.job.title, settings.search)
  await db.application.update({
    where: { id: applicationId },
    data: {
      toEmail: next,
      bounceCount,
      status: requeue ? 'QUEUED' : 'REVIEW',
      scheduledFor: requeue ? await nextSlot(app.job.countryCode) : null,
      sentAt: null,
      followUpDueAt: null,
      lastActivityAt: new Date(),
      notes: `Bounced at ${app.toEmail}. Trying ${next} next (${bounceCount}/${MAX_BOUNCE_RETRIES}).${requeue ? '' : ' Approve to resend.'}`,
    },
  })
  return { next, requeued: requeue, exhausted: false }
}
