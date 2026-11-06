import { generateJson } from '@/lib/ai/gemini'
import { NoKeyAvailableError } from '@/lib/ai/key-pool'
import { enrichPrompt } from '@/lib/ai/prompts'
import { enrichBatchSchema, type EnrichItem } from '@/lib/ai/schemas'
import { loadCandidateContext } from '@/lib/candidate/load'
import { db } from '@/lib/db'
import type { SponsorshipLevel } from '@/lib/domain'
import { isUsableContact } from '@/lib/email/address'
import type { AppSettings } from '@/lib/settings/schema'
import { extractEmails } from '@/lib/text'
import { chunk } from '@/lib/utils/semaphore'
import { runPool } from '@/lib/utils/pool'
import { detectAts } from './ats-detect'
import type { RunLogger } from './logger'

/** Enrichment batches in flight at once. */
export const ENRICH_CONCURRENCY = 3

const LEVEL_RANK: Record<SponsorshipLevel, number> = { no: 0, unknown: 1, likely: 2, yes: 3 }

function maxLevel(a: SponsorshipLevel, b: SponsorshipLevel): SponsorshipLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}

/**
 * Enrich jobs with the lite model in batches. Merges source flags + regex email
 * extraction with the LLM's read of the description.
 */
export async function enrichJobs(jobIds: string[], settings: AppSettings, log: RunLogger, shouldStop?: () => Promise<boolean>): Promise<{ enriched: number; errors: number }> {
  if (jobIds.length === 0) return { enriched: 0, errors: 0 }
  const jobs = await db.job.findMany({
    where: { id: { in: jobIds } },
    include: { company: { select: { knownSponsor: true, contactEmail: true } } },
  })
  // Who the facts are for (profession, home country, sponsorship need): steers what the model looks for.
  const candidate = await loadCandidateContext()
  let enriched = 0
  let errors = 0
  let quotaGone = false
  let stopLogged = false

  // Batches run side by side (ENRICH_CONCURRENCY); the AI semaphore still bounds the calls in flight.
  const enrichBatch = async (batch: typeof jobs): Promise<boolean> => {
    if (quotaGone) return false
    let items: EnrichItem[] = []
    try {
      const p = enrichPrompt(
        batch.map((j) => ({ id: j.id, title: j.title, company: j.companyName, location: j.location, countryCode: j.countryCode, url: j.url, description: j.description })),
        candidate,
      )
      const r = await generateJson({ task: 'enrich', model: 'lite', schema: enrichBatchSchema, system: p.system, prompt: p.prompt, temperature: 0.2, maxOutputTokens: 8192 })
      items = r.data.items
    } catch (err) {
      if (err instanceof NoKeyAvailableError) {
        // Not an error: today's AI quota is used up. The rest stays un-enriched and the next run picks it up.
        if (!quotaGone) log.info(`Enrich: daily AI quota used up after ${enriched} job(s); the rest wait for the next run`)
        quotaGone = true
        return false
      }
      errors += batch.length
      log.warn(`Enrich batch failed: ${err instanceof Error ? err.message : err}`, { jobIds: batch.map((j) => j.id) })
      return true
    }
    const byId = new Map(items.map((i) => [i.id, i]))
    // Batches occasionally drop an item; retry those one at a time.
    for (const job of batch) {
      if (byId.has(job.id)) continue
      try {
        const p = enrichPrompt([{ id: job.id, title: job.title, company: job.companyName, location: job.location, countryCode: job.countryCode, url: job.url, description: job.description }], candidate)
        const r = await generateJson({ task: 'enrich', model: 'lite', schema: enrichBatchSchema, system: p.system, prompt: p.prompt, temperature: 0.2, maxOutputTokens: 4096 })
        const single = r.data.items.find((i) => i.id === job.id) ?? r.data.items[0]
        if (single) byId.set(job.id, { ...single, id: job.id })
      } catch (err) {
        log.warn(`Enrich retry failed for ${job.id}: ${err instanceof Error ? err.message : err}`)
      }
    }
    for (const job of batch) {
      const item = byId.get(job.id)
      if (!item) {
        errors++
        log.warn(`Enrich response missing job ${job.id}`)
        continue
      }
      try {
        let sponsorship: SponsorshipLevel = item.sponsorship
        if (job.visaFlag === true) sponsorship = maxLevel(sponsorship, 'likely')
        if (job.company.knownSponsor && sponsorship !== 'no') sponsorship = maxLevel(sponsorship, 'likely')

        // Postings mention accommodation, privacy and support mailboxes; only recruiting-style addresses may become the recipient.
        const regexEmail = extractEmails(job.description).find(isUsableContact)
        const contactEmail = [job.contactEmail, item.contactEmail, regexEmail, job.company.contactEmail].find((e) => e && isUsableContact(e)) ?? null
        const atsType = detectAts(job.url)
        const applyChannel = contactEmail ? 'email' : atsType ? 'ats' : item.applyChannel === 'email' ? 'portal' : item.applyChannel

        await db.job.update({
          where: { id: job.id },
          data: {
            sponsorship,
            sponsorshipEvidence: item.sponsorshipEvidence.slice(0, 4),
            seniority: item.seniority,
            requiredLanguages: item.requiredLanguages,
            mustHaveSkills: item.mustHaveSkills,
            niceToHaveSkills: item.niceToHaveSkills,
            ...(job.salaryMin == null && item.salaryEurMin ? { salaryMin: Math.round(item.salaryEurMin), currency: 'EUR' } : {}),
            contactEmail,
            applyChannel,
            atsType,
            relocationSupport: item.relocationSupport,
            summary: item.summary,
            enrichedAt: new Date(),
          },
        })
        enriched++
      } catch (err) {
        errors++
        log.warn(`Enrich update failed for ${job.id}: ${err instanceof Error ? err.message : err}`)
      }
    }
    return true
  }

  await runPool(chunk(jobs, settings.ai.enrichBatchSize), ENRICH_CONCURRENCY, enrichBatch, async () => {
    const stop = Boolean(await shouldStop?.())
    if (stop && !stopLogged) {
      stopLogged = true
      log.info('Enrich: stopped by user; remaining jobs are enriched on the next run')
    }
    return stop
  })
  return { enriched, errors }
}
