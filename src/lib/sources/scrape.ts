import { z } from 'zod'
import { generateJson } from '@/lib/ai/gemini'
import { sha1 } from '@/lib/crypto'
import { countryName } from '@/lib/domain'
import { isUsableContact } from '@/lib/email/address'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { extractEmails, truncate } from '@/lib/text'
import { sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, ScrapeTargetRef, SearchParams, SourceContext } from './types'

/**
 * Browser scraping source. Opens a real (headless) Chromium via Playwright, visits
 * each configured list page, discovers job links, reads each posting, keeps the
 * ones that expose an email address (configurable) and asks Gemini (lite model)
 * to turn the page text into the fields we store.
 *
 * Politeness: honours robots.txt Disallow for "*", one page at a time, a pause
 * between pages, a small per-target link cap, images/fonts/media blocked.
 * Playwright is imported lazily so the web bundle never includes it.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 job-pilot'

const JOB_PATH_RE = /(job|jobs|vacanc|career|careers|position|opening|stelle|stellen|vacature|offre|empleo|posting|role|opportunit)/i
const NAV_TEXT_RE = /^(home|about|contact|login|log in|sign in|sign up|register|privacy|terms|cookies?|blog|news|help|faq|next|previous|more|›|»|«|‹|\d+)$/i

const scrapedJobSchema = z.object({
  isJobPosting: z.boolean().describe('true only if the page is a single job posting (not a list, company page or article)'),
  title: z.string().max(200),
  company: z.string().max(200),
  location: z.string().max(200).nullable(),
  countryCode: z.string().length(2).nullable().describe('ISO-3166 alpha-2 of the job location, null if unknown'),
  remote: z.boolean(),
  description: z.string().max(8000).describe('The posting text: responsibilities, requirements, benefits, how to apply. Plain text, no navigation or footer noise.'),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  currency: z.string().max(3).nullable(),
  postedAt: z.string().nullable().describe('ISO date if the page states when it was posted, else null'),
  contactEmail: z.string().nullable().describe('The email address applications should go to, if the posting gives one'),
})

type PlaywrightModule = typeof import('playwright')

let playwrightModule: PlaywrightModule | null = null
async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!playwrightModule) playwrightModule = await import('playwright')
  return playwrightModule
}

const robotsCache = new Map<string, string[]>()

/** Disallow rules for "*" from robots.txt (cached per origin). Empty = allowed. */
async function robotsDisallows(origin: string, fetchImpl: typeof fetch): Promise<string[]> {
  const cached = robotsCache.get(origin)
  if (cached) return cached
  let rules: string[] = []
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT } })
    if (res.ok) {
      const text = await res.text()
      let applies = false
      for (const raw of text.split('\n')) {
        const line = raw.split('#')[0].trim()
        if (!line) continue
        const [k, ...rest] = line.split(':')
        const v = rest.join(':').trim()
        if (/^user-agent$/i.test(k)) applies = v === '*'
        else if (applies && /^disallow$/i.test(k) && v) rules.push(v)
      }
    }
  } catch {
    rules = []
  }
  robotsCache.set(origin, rules)
  return rules
}

function isDisallowed(url: URL, rules: string[]): boolean {
  return rules.some((r) => r !== '/' && url.pathname.startsWith(r.replace(/\*$/, '')))
}

export function looksLikeJobLink(href: string, text: string, baseHost: string): boolean {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return false
  }
  if (!/^https?:$/.test(u.protocol)) return false
  const hostOk = u.hostname === baseHost || u.hostname.endsWith(`.${baseHost.replace(/^www\./, '')}`)
  if (!hostOk) return false
  if (!JOB_PATH_RE.test(u.pathname + u.search)) return false
  const t = text.trim()
  if (t.length < 8 || NAV_TEXT_RE.test(t)) return false
  if (/\.(pdf|jpg|png|zip)$/i.test(u.pathname)) return false
  return true
}

interface PageRead {
  url: string
  title: string
  text: string
  emails: string[]
}

// In-page scripts are passed as strings: tsx/esbuild rewrites named inner functions with a
// `__name` helper that does not exist inside the browser, so serialised callbacks would throw.
const READ_POSTING_SCRIPT = `(() => {
  const candidates = ['main', 'article', '[class*="job-description"]', '[id*="job-description"]', '[class*="description"]', '[id*="description"]', '[class*="posting"]', '[class*="vacancy"]']
  let text = ''
  for (const sel of candidates) {
    const el = document.querySelector(sel)
    if (el && el.innerText && el.innerText.trim().length > 400) { text = el.innerText; break }
  }
  if (!text) text = document.body ? document.body.innerText : ''
  const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0])
  return { title: document.title, text, mailtos }
})()`

const COLLECT_LINKS_SCRIPT = (selector: string) => `(() => {
  const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
  return els.map((el) => {
    const a = el.tagName === 'A' ? el : el.querySelector('a')
    return { href: a && a.href ? a.href : '', text: el.innerText || '' }
  })
})()`

async function readPosting(page: import('playwright').Page, url: string, waitMs: number): Promise<PageRead> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(waitMs)
  const read = (await page.evaluate(READ_POSTING_SCRIPT)) as { title: string; text: string; mailtos: string[] }
  const text = read.text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const emails = [...new Set([...extractEmails(read.mailtos.join(' ')), ...extractEmails(text)])]
  return { url, title: read.title, text, emails }
}

async function discoverLinks(page: import('playwright').Page, target: ScrapeTargetRef, url: string): Promise<string[]> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(target.waitMs)
  const base = new URL(url)
  const anchors = (await page.evaluate(COLLECT_LINKS_SCRIPT(target.linkSelector ?? 'a[href]'))) as Array<{ href: string; text: string }>
  const pattern = target.linkPattern ? new RegExp(target.linkPattern, 'i') : null
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of anchors) {
    if (!a.href) continue
    const clean = a.href.split('#')[0]
    if (seen.has(clean)) continue
    const ok = pattern ? pattern.test(clean) : target.linkSelector ? true : looksLikeJobLink(clean, a.text, base.hostname)
    if (!ok) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= target.maxLinks) break
  }
  return out
}

/**
 * Fill {query} / {location} / {page} in a target URL from the search settings.
 * {query}: up to 3 configured queries; {location}: the target's country or the first priority
 * tier; {page}: 1..maxPages. Without placeholders the URL is used once.
 */
export function expandTargetUrls(target: ScrapeTargetRef, ctx: Pick<SourceContext, 'search'>): string[] {
  const hasQuery = target.url.includes('{query}')
  const hasLocation = target.url.includes('{location}')
  const hasPage = target.url.includes('{page}')
  const queries = hasQuery ? ctx.search.queries.slice(0, 3) : ['']
  const countries = hasLocation ? (target.countryCode ? [target.countryCode] : (ctx.search.priorityTiers[0] ?? ctx.search.countries).slice(0, 3)) : ['']
  const pages = hasPage ? Array.from({ length: Math.max(1, target.maxPages) }, (_, i) => i + 1) : [1]
  const out: string[] = []
  for (const q of queries) {
    for (const c of countries) {
      for (const p of pages) {
        out.push(
          target.url
            .replace('{query}', encodeURIComponent(q))
            .replace('{location}', encodeURIComponent(c ? countryName(c) || c : ''))
            .replace('{page}', String(p)),
        )
      }
    }
  }
  return [...new Set(out)]
}

export interface ScrapeTargetResult {
  jobs: NormalizedJob[]
  visited: number
  skippedNoEmail: number
  skippedNotJob: number
  requests: number
  error?: string
}

export async function scrapeOneTarget(target: ScrapeTargetRef, ctx: SourceContext, maxDaysOld: number): Promise<ScrapeTargetResult> {
  const result: ScrapeTargetResult = { jobs: [], visited: 0, skippedNoEmail: 0, skippedNotJob: 0, requests: 0 }
  const pw = await loadPlaywright()
  const browser = await pw.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 }, locale: 'en-IE' })
    await context.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    const origin = new URL(target.url).origin
    const rules = await robotsDisallows(origin, ctx.fetch)
    const cutoff = Date.now() - maxDaysOld * 86_400_000

    const links: string[] = []
    // A target URL may carry {query}, {location} and {page}: they are filled from the search
    // settings (queries, priority countries) so one target covers every preference.
    for (const listUrl of expandTargetUrls(target, ctx)) {
      if (links.length >= target.maxLinks) break
      if (isDisallowed(new URL(listUrl), rules)) {
        ctx.log('warn', `${target.name}: robots.txt disallows ${listUrl}; skipping`)
        break
      }
      result.requests++
      const found = await discoverLinks(page, target, listUrl)
      for (const l of found) if (!links.includes(l)) links.push(l)
      ctx.log('debug', `${target.name}: ${listUrl} → ${found.length} candidate links`)
      if (found.length === 0 && listUrl.includes('page=')) continue
      await sleep(800 + Math.random() * 700)
    }

    for (const link of links.slice(0, target.maxLinks)) {
      if (isDisallowed(new URL(link), rules)) continue
      result.requests++
      result.visited++
      let read: PageRead
      try {
        read = await readPosting(page, link, target.waitMs)
      } catch (err) {
        ctx.log('warn', `${target.name}: could not read ${link}: ${err instanceof Error ? err.message : err}`)
        continue
      }
      if (target.requireEmail && read.emails.length === 0) {
        result.skippedNoEmail++
        continue
      }
      if (read.text.length < 300) {
        result.skippedNotJob++
        continue
      }
      try {
        const r = await generateJson({
          task: 'enrich',
          model: 'lite',
          schema: scrapedJobSchema,
          temperature: 0.1,
          maxOutputTokens: 4096,
          system:
            'You turn the visible text of a web page into a structured job posting. If the page is not a single job posting, set isJobPosting=false and leave other fields minimal. Copy the posting text into description as clean plain text without navigation, cookie banners or footers. Never invent an email: only use one that appears in the text.',
          prompt: `Page URL: ${read.url}\nPage title: ${read.title}\nEmail addresses seen on the page: ${read.emails.join(', ') || 'none'}\n\nPage text:\n${truncate(read.text, 14000)}`,
        })
        const j = r.data
        if (!j.isJobPosting || !j.title || !j.company) {
          result.skippedNotJob++
          continue
        }
        const postedAt = j.postedAt ? new Date(j.postedAt) : undefined
        if (postedAt && !Number.isNaN(postedAt.getTime()) && postedAt.getTime() < cutoff) continue
        const usable = read.emails.filter(isUsableContact)
        const contactEmail = (j.contactEmail && usable.includes(j.contactEmail.toLowerCase()) ? j.contactEmail.toLowerCase() : usable[0]) ?? undefined
        result.jobs.push({
          source: 'scrape',
          externalId: sha1(read.url),
          url: read.url,
          title: j.title,
          company: j.company,
          location: j.location ?? undefined,
          countryCode: j.countryCode?.toUpperCase() ?? guessCountry(j.location, target.countryCode ?? undefined),
          remote: j.remote || isRemoteLocation(j.location),
          description: j.description || read.text.slice(0, 8000),
          salaryMin: j.salaryMin ?? undefined,
          salaryMax: j.salaryMax ?? undefined,
          currency: j.currency ?? undefined,
          postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
          visaSponsorship: null,
          tags: ['scrape', target.name],
          contactEmail,
          raw: { targetId: target.id, pageTitle: read.title, emails: read.emails },
        })
      } catch (err) {
        ctx.log('warn', `${target.name}: extraction failed for ${link}: ${err instanceof Error ? err.message : err}`)
      }
      await sleep(600 + Math.random() * 900)
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    await browser.close().catch(() => undefined)
  }
  return result
}

export const scrapeAdapter: JobSourceAdapter = {
  id: 'scrape',
  label: 'Browser scraping',
  usesQuery: false,
  usesCountry: false,
  isConfigured: (ctx) => (ctx.scrapeTargets?.length ?? 0) > 0,
  async fetch(params: SearchParams, ctx: SourceContext) {
    const jobs: NormalizedJob[] = []
    let requests = 0
    for (const t of ctx.scrapeTargets ?? []) {
      const r = await scrapeOneTarget(t, ctx, params.maxDaysOld)
      requests += r.requests
      jobs.push(...r.jobs)
      const status = r.error ? 'error' : 'ok'
      ctx.log(r.error ? 'error' : 'info', `${t.name}: visited ${r.visited}, ${r.jobs.length} jobs, ${r.skippedNoEmail} without email, ${r.skippedNotJob} not postings${r.error ? `, error: ${r.error}` : ''}`)
      await ctx.onScrapeTargetDone?.(t.id, { status, found: r.jobs.length, error: r.error })
    }
    return { jobs, hasMore: false, requests }
  },
}

/**
 * Read several postings with one browser (used by the deep-fetch step for
 * sources that only give short snippets, e.g. Jooble/Adzuna).
 */
export async function readPostings(urls: string[], opts: { waitMs?: number; log?: (m: string) => void } = {}): Promise<Map<string, PageRead>> {
  const out = new Map<string, PageRead>()
  if (urls.length === 0) return out
  const pw = await loadPlaywright()
  const browser = await pw.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 }, locale: 'en-IE' })
    await context.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    for (const url of urls) {
      try {
        const origin = new URL(url).origin
        const rules = await robotsDisallows(origin, globalThis.fetch)
        if (isDisallowed(new URL(url), rules)) {
          opts.log?.(`robots.txt disallows ${url}`)
          continue
        }
        const read = await readPosting(page, url, opts.waitMs ?? 1200)
        // Follow one redirect hop (aggregators link to the employer page); record the final URL too.
        out.set(url, { ...read, url: page.url() })
      } catch (err) {
        opts.log?.(`could not read ${url}: ${err instanceof Error ? err.message : err}`)
      }
      await sleep(500 + Math.random() * 700)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return out
}

export interface BrowserPage {
  html: string
  finalUrl: string
}

/**
 * Open one headless browser and hand back a page reader, for sites that answer
 * plain HTTP fetches with 403/429 bot checks (contact discovery uses this to
 * crawl a company's careers/contact pages). Reads are sequential and honour
 * robots.txt; a failed read returns null instead of throwing.
 */
export async function withBrowserReader<T>(fn: (read: (url: string) => Promise<BrowserPage | null>) => Promise<T>, opts: { waitMs?: number; timeoutMs?: number; log?: (m: string) => void } = {}): Promise<T> {
  const pw = await loadPlaywright()
  const browser = await pw.chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 }, locale: 'en-IE' })
    await context.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (['image', 'media', 'font', 'stylesheet'].includes(type)) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    const read = async (url: string): Promise<BrowserPage | null> => {
      try {
        const origin = new URL(url).origin
        const rules = await robotsDisallows(origin, globalThis.fetch)
        if (isDisallowed(new URL(url), rules)) {
          opts.log?.(`robots.txt disallows ${url}`)
          return null
        }
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 20_000 })
        if (res && res.status() >= 400) {
          opts.log?.(`browser got ${res.status()} for ${url}`)
          return null
        }
        await page.waitForTimeout(opts.waitMs ?? 1000)
        // Client-side redirects can still be in flight; settle once, then read.
        let html: string
        try {
          html = await page.content()
        } catch {
          await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined)
          await page.waitForTimeout(500)
          html = await page.content()
        }
        await sleep(300 + Math.random() * 400)
        return { html, finalUrl: page.url() }
      } catch (err) {
        opts.log?.(`browser could not read ${url}: ${err instanceof Error ? err.message : err}`)
        return null
      }
    }
    return await fn(read)
  } finally {
    await browser.close().catch(() => undefined)
  }
}
