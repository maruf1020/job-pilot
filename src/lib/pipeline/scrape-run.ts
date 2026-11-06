import { db } from '@/lib/db'
import { sourceCredentials } from '@/lib/keys/service-keys'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { scrapeOneTarget } from '@/lib/sources/scrape'
import { ingestNormalizedJob } from './ingest'

/** Run one scrape target on demand (outside a full search run) and ingest what it finds. */
export async function runScrapeTarget(targetId: string, log: (m: string) => void = console.log) {
  const target = await db.scrapeTarget.findUnique({ where: { id: targetId } })
  if (!target) throw new Error('Scrape target not found')
  const settings = await getSettings()
  const r = await scrapeOneTarget(
    target,
    {
      search: settings.search,
      env: await sourceCredentials(),
      fetch: globalThis.fetch,
      log: (level, message) => log(`[${level}] ${message}`),
    },
    settings.search.maxDaysOld,
  )
  let created = 0
  let updated = 0
  for (const nj of r.jobs) {
    try {
      const out = await ingestNormalizedJob(nj)
      if (out.outcome === 'created') created++
      else if (out.outcome === 'updated') updated++
    } catch (err) {
      log(`ingest failed for ${nj.url}: ${err instanceof Error ? err.message : err}`)
    }
  }
  await db.scrapeTarget.update({
    where: { id: targetId },
    data: { lastRunAt: new Date(), lastStatus: r.error ? 'error' : 'ok', lastError: r.error?.slice(0, 500) ?? null, lastFound: r.jobs.length },
  })
  await notify(
    r.error ? 'error' : 'run_complete',
    `Scrape "${target.name}" ${r.error ? 'failed' : 'finished'}`,
    r.error ?? `${r.visited} pages visited, ${created} new jobs, ${r.skippedNoEmail} skipped without an email`,
    '/jobs?filter[source]=scrape',
  )
  return { ...r, created, updated }
}
