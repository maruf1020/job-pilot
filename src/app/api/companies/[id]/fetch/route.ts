import { badRequest, notFound, ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import type { AtsType } from '@/lib/domain'
import { sourceCredentials } from '@/lib/keys/service-keys'
import { ingestNormalizedJob } from '@/lib/pipeline/ingest'
import { getSettings } from '@/lib/settings/service'
import { fetchCompanyBoard } from '@/lib/sources/ats'

/** POST /api/companies/:id/fetch → pull this company's ATS board right now. */
export const POST = route(async (_req, { params }) => {
  const { id } = await params
  const c = await db.company.findUnique({ where: { id } })
  if (!c) throw notFound('Company')
  if (!c.atsType || !c.atsSlug) throw badRequest('Company has no ATS board configured')
  const settings = await getSettings()
  const started = Date.now()
  try {
    const { jobs, requests } = await fetchCompanyBoard(
      { id: c.id, name: c.name, atsType: c.atsType as AtsType, atsSlug: c.atsSlug, knownSponsor: c.knownSponsor },
      { search: settings.search, env: await sourceCredentials(), fetch: globalThis.fetch, log: () => undefined },
      settings.search.maxDaysOld,
    )
    let created = 0
    let updated = 0
    for (const nj of jobs) {
      const r = await ingestNormalizedJob(nj)
      if (r.outcome === 'created') created++
      else if (r.outcome === 'updated') updated++
    }
    await db.company.update({ where: { id }, data: { lastFetchedAt: new Date(), lastFetchError: null } })
    return ok({ fetched: jobs.length, created, updated, requests, ms: Date.now() - started }, { message: `${jobs.length} engineering roles found, ${created} new` })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.company.update({ where: { id }, data: { lastFetchedAt: new Date(), lastFetchError: message.slice(0, 500) } })
    throw badRequest(`Board fetch failed: ${message}`)
  }
})
