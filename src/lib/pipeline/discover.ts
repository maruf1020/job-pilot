import { boardResting, restingUntil, restSource } from './source-rest'
import { db } from '@/lib/db'
import type { AtsType, SourceId } from '@/lib/domain'
import { sourceCredentials } from '@/lib/keys/service-keys'
import { SOURCE_ADAPTERS, SOURCE_ORDER } from '@/lib/sources/registry'
import type { NormalizedJob, SearchParams, SourceContext } from '@/lib/sources/types'
import type { AppSettings } from '@/lib/settings/schema'
import { ingestNormalizedJob } from './ingest'
import type { RunLogger } from './logger'
import { getProfile } from './profile'
import { advanceCursor, allCombos, describePlan, expandQueries, loadCursors, planCombos, type PlannedCombo } from './rotation'
import { runPool } from '@/lib/utils/pool'

/** Sources read at the same time in one run. */
export const SOURCE_CONCURRENCY = 4

export interface DiscoveryResult {
  fetched: number
  created: number
  duplicates: number
  blacklisted: number
  errors: number
  newJobIds: string[]
}

async function jsearchCallsToday(): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const agg = await db.searchRunSource.aggregate({ where: { source: 'jsearch', createdAt: { gte: since } }, _sum: { requests: true } })
  return agg._sum.requests ?? 0
}

/**
 * Which (query × country) combinations a source runs in this run. With rotation on, the
 * least recently searched ones go first and each continues from its last result page;
 * without it, the first `combosPerSource` in priority order (the old behaviour).
 */
async function combosFor(sourceId: SourceId, settings: AppSettings, queries: string[], log: RunLogger): Promise<PlannedCombo[]> {
  const adapter = SOURCE_ADAPTERS[sourceId]
  const candidates = allCombos(sourceId, settings, queries)
  const rotation = settings.search.rotation
  // Feeds without query/country still rotate through their pages; jsearch keeps its own budget rule.
  const take = adapter.usesQuery || adapter.usesCountry ? (sourceId === 'jsearch' ? 1 : rotation.combosPerSource) : 1
  if (!rotation.enabled) return candidates.slice(0, take).map((c) => ({ ...c, startPage: 1, neverRun: false }))
  const plan = planCombos(candidates, await loadCursors(sourceId), { take, cycleDays: rotation.cycleDays })
  if (candidates.length > 1) log.info(`${adapter.label}: rotation covers ${describePlan(plan, candidates.length)}`)
  return plan
}

export async function runDiscovery(runId: string, settings: AppSettings, log: RunLogger, only?: SourceId[], shouldStop?: () => Promise<boolean>): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { fetched: 0, created: 0, duplicates: 0, blacklisted: 0, errors: 0, newJobIds: [] }
  const seenExternal = new Set<string>()
  const profile = await getProfile()
  const queries = expandQueries(settings, profile ? { titles: profile.titles, skills: profile.skills, stopSkills: profile.stopSkills } : null)
  if (queries.length > settings.search.queries.length) log.info(`Queries: ${settings.search.queries.length} configured + ${queries.length - settings.search.queries.length} variants from the profile`)

  // Boards whose last fetch failed with a server error or rate limit rest 6-12 hours (Truist and Oxford
  // answered HTTP 500 on every run).
  const atsCompanies = (
    await db.company.findMany({
      where: { atsType: { not: null }, atsSlug: { not: null }, blacklisted: false },
      select: { id: true, name: true, atsType: true, atsSlug: true, knownSponsor: true, lastFetchError: true, lastFetchedAt: true },
    })
  ).filter((c) => !boardResting(c.lastFetchError, c.lastFetchedAt))
  const scrapeTargets = await db.scrapeTarget.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
  const ctx: SourceContext = {
    search: settings.search,
    skills: settings.ranking.stackKeywords,
    // Onboarding zeroes the sponsorship weights for a person who never needs a visa where they search.
    sponsorship: settings.ranking.weights.sponsorshipYes > 0,
    env: await sourceCredentials(),
    fetch: globalThis.fetch,
    log: (level, message, meta) => log.log(level, message, meta),
    atsCompanies: atsCompanies.map((c) => ({ id: c.id, name: c.name, atsType: c.atsType as AtsType, atsSlug: c.atsSlug!, knownSponsor: c.knownSponsor })),
    scrapeTargets: only && !only.includes('scrape') ? [] : scrapeTargets,
    onScrapeTargetDone: async (targetId, r) => {
      await db.scrapeTarget.update({ where: { id: targetId }, data: { lastRunAt: new Date(), lastStatus: r.status, lastError: r.error?.slice(0, 500) ?? null, lastFound: r.found } }).catch(() => undefined)
    },
    onAtsCompanyDone: async (companyId, r) => {
      const notFound = Boolean(r.error && /HTTP 404|not found/i.test(r.error))
      const prev = notFound ? await db.company.findUnique({ where: { id: companyId }, select: { lastFetchError: true, atsType: true, atsSlug: true } }) : null
      if (prev?.lastFetchError && /HTTP 404|not found/i.test(prev.lastFetchError)) {
        await db.company
          .update({ where: { id: companyId }, data: { atsType: null, atsSlug: null, lastFetchedAt: new Date(), lastFetchError: null, notes: `Board ${prev.atsType}/${prev.atsSlug} returned "not found" twice; removed ${new Date().toISOString().slice(0, 10)}. Use Companies → Find company boards to look for its new board.` } })
          .catch(() => undefined)
        log.info(`Removed dead board ${prev.atsType}/${prev.atsSlug} (not found twice in a row)`)
        return
      }
      await db.company.update({ where: { id: companyId }, data: { lastFetchedAt: new Date(), lastFetchError: r.error?.slice(0, 500) ?? null } }).catch(() => undefined)
    },
  }

  const maxJobs = settings.search.maxJobsPerRun

  // Sources run side by side (each keeps its own order of combinations, pages and pauses), so one slow
  // source (LinkedIn, the company boards) no longer holds up the others for the whole run.
  const runSource = async (sourceId: SourceId): Promise<void> => {
    const cfg = settings.search.sources[sourceId as keyof typeof settings.search.sources]
    if (!cfg?.enabled) return
    const adapter = SOURCE_ADAPTERS[sourceId]
    if (!adapter.isConfigured(ctx)) {
      log.info(`${adapter.label}: skipped (not configured)`)
      return
    }
    // A source that answered 429 or failed rests 6-12 hours instead of failing again on every run.
    const resting = await restingUntil(sourceId)
    if (resting) {
      log.info(`${adapter.label}: resting until ${resting.until.toISOString().slice(11, 16)} UTC after ${resting.reason}; asked again then`)
      return
    }
    if (sourceId === 'jsearch') {
      const used = await jsearchCallsToday()
      const budget = settings.search.sources.jsearch.dailyBudget
      if (used >= budget) {
        log.info(`JSearch: daily budget ${budget} used`)
        return
      }
    }
    // Per-source cap so one big feed cannot starve the others; the run-wide cap is a safety net.
    if (result.created >= maxJobs * 5) {
      log.warn(`Reached the run-wide cap of ${maxJobs * 5} new jobs; skipping ${adapter.label}`)
      return
    }
    let sourceFetched = 0

    for (const combo of await combosFor(sourceId, settings, queries, log)) {
      if (await shouldStop?.()) break
      if (sourceFetched >= maxJobs) {
        log.info(`${adapter.label}: per-source cap (${maxJobs}) reached`)
        break
      }
      if (result.created >= maxJobs * 5) break
      const started = Date.now()
      const stats = { requests: 0, returned: 0, created: 0, duplicates: 0, errors: 0, error: null as string | null }
      let lastPage = combo.startPage
      let hasMore = false
      try {
        for (let page = combo.startPage; page < combo.startPage + cfg.maxPages; page++) {
          lastPage = page
          const params: SearchParams = { query: combo.query, countryCode: combo.countryCode, maxDaysOld: settings.search.maxDaysOld, page }
          const r = await adapter.fetch(params, ctx)
          hasMore = r.hasMore
          stats.requests += r.requests
          stats.returned += r.jobs.length
          for (const nj of r.jobs) {
            const key = `${nj.source}:${nj.externalId}`
            if (seenExternal.has(key)) continue
            seenExternal.add(key)
            if (!isValid(nj)) continue
            result.fetched++
            sourceFetched++
            try {
              const out = await ingestNormalizedJob(nj)
              if (out.outcome === 'created' && out.jobId) {
                stats.created++
                result.created++
                result.newJobIds.push(out.jobId)
              } else if (out.outcome === 'updated') {
                stats.duplicates++
                result.duplicates++
              } else result.blacklisted++
            } catch (err) {
              stats.errors++
              result.errors++
              log.warn(`Ingest failed for ${nj.title} @ ${nj.company}: ${err instanceof Error ? err.message : err}`)
            }
          }
          if (!r.hasMore || sourceFetched >= maxJobs) break
          if (sourceId === 'jsearch') break
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // A key without a subscription is a setup step, not a failure: skip the source quietly for this run.
        if (/not subscribed|subscription required|invalid api key|HTTP 401/i.test(message)) {
          log.info(`${adapter.label}: skipped (${/not subscribed/i.test(message) ? 'the API key is not subscribed to this API yet' : 'the API key is not accepted'})`)
          break
        }
        stats.error = message
        // Rate limited or the server down: rest the whole source (the limit is per IP, so the next country
        // fails the same way) and say so, instead of an error on every country of every run.
        const rested = await restSource(sourceId, message).catch(() => null)
        if (rested) {
          log.warn(`${adapter.label}: ${message.slice(0, 160)}; resting until ${rested.until.toISOString().slice(11, 16)} UTC (${rested.reason})`)
          await db.searchRunSource.create({ data: { runId, source: sourceId, query: combo.query || null, country: combo.countryCode ?? null, ...stats, error: stats.error, durationMs: Date.now() - started } })
          break
        }
        stats.errors++
        result.errors++
        log.error(`${adapter.label} ${combo.query ? `"${combo.query}"` : ''} ${combo.countryCode ?? ''}: ${stats.error}`)
      }
      await db.searchRunSource.create({
        data: { runId, source: sourceId, query: combo.query || null, country: combo.countryCode ?? null, ...stats, error: stats.error, durationMs: Date.now() - started },
      })
      if (settings.search.rotation.enabled && !stats.error) {
        await advanceCursor(sourceId, combo, { lastPage, hasMore: hasMore && sourceFetched < maxJobs, created: stats.created }).catch(() => undefined)
      }
      log.info(
        `${adapter.label}${combo.query ? ` "${combo.query}"` : ''}${combo.countryCode ? ` [${combo.countryCode}]` : ''}${combo.startPage > 1 ? ` (from page ${combo.startPage})` : ''}: ${stats.returned} returned, ${stats.created} new, ${stats.duplicates} seen`,
      )
    }
  }

  const sources = SOURCE_ORDER.filter((id) => !only || only.includes(id))
  let stopLogged = false
  await runPool(sources, SOURCE_CONCURRENCY, async (sourceId) => {
    try {
      await runSource(sourceId)
    } catch (err) {
      // One source's database or adapter error must not take the other sources down with it.
      result.errors++
      log.error(`${SOURCE_ADAPTERS[sourceId]?.label ?? sourceId}: ${err instanceof Error ? err.message : err}`)
    }
  }, async () => {
    const stop = Boolean(await shouldStop?.())
    if (stop && !stopLogged) {
      stopLogged = true
      log.info('Discovery: stopped by user')
    }
    return stop
  })
  return result
}

function isValid(nj: NormalizedJob): boolean {
  return Boolean(nj.title && nj.company && nj.url && nj.externalId)
}
