import { db } from '@/lib/db'
import { isUsableContact } from '@/lib/email/address'
import type { AppSettings } from '@/lib/settings/schema'
import { readPostings } from '@/lib/sources/scrape'
import { extractEmails } from '@/lib/text'
import type { RunLogger } from './logger'

/**
 * Sources like Jooble and Adzuna only return snippets. For NEW jobs with a short
 * description, open the posting in the headless browser, keep the fuller text
 * and any email found on the page. Runs before the prefilter so language and
 * sponsorship checks see the real posting.
 */
export async function deepFetchShortJobs(settings: AppSettings, log: RunLogger): Promise<{ fetched: number; improved: number; emails: number }> {
  const cfg = settings.search
  if (!cfg.deepFetch || cfg.deepFetchLimit === 0) return { fetched: 0, improved: 0, emails: 0 }
  // Adzuna's own detail pages sit behind a bot check and never render the posting; skip them.
  const candidates = await db.$queryRaw<Array<{ id: string; url: string }>>`
    SELECT id, url FROM "Job"
    WHERE status = 'NEW' AND "enrichedAt" IS NULL AND length(description) < ${cfg.deepFetchMinChars}
      AND url NOT LIKE '%adzuna.%'
    ORDER BY "firstSeenAt" DESC LIMIT ${cfg.deepFetchLimit}`
  if (candidates.length === 0) return { fetched: 0, improved: 0, emails: 0 }
  log.info(`Deep fetch: opening ${candidates.length} short listings in the browser`)
  let improved = 0
  let emails = 0
  let pages: Awaited<ReturnType<typeof readPostings>>
  try {
    pages = await readPostings(
      candidates.map((c) => c.url),
      { log: (m) => log.debug(`deep-fetch: ${m}`) },
    )
  } catch (err) {
    log.warn(`Deep fetch unavailable (is Chromium installed? run "npx playwright install chromium"): ${err instanceof Error ? err.message : err}`)
    return { fetched: 0, improved: 0, emails: 0 }
  }
  for (const c of candidates) {
    const read = pages.get(c.url)
    if (!read) continue
    const existing = await db.job.findUnique({ where: { id: c.id }, select: { description: true, contactEmail: true } })
    if (!existing) continue
    const data: { description?: string; contactEmail?: string } = {}
    if (read.text.length > existing.description.length + 200) {
      data.description = read.text.slice(0, 20_000)
      improved++
    }
    const email = [...read.emails, ...extractEmails(read.text)].find(isUsableContact)
    if (!existing.contactEmail && email) {
      data.contactEmail = email
      emails++
    }
    if (Object.keys(data).length) await db.job.update({ where: { id: c.id }, data })
  }
  log.info(`Deep fetch: ${pages.size} read, ${improved} descriptions improved, ${emails} emails found`)
  return { fetched: pages.size, improved, emails }
}
