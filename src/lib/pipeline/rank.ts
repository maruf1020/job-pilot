import type { Prisma } from '@/generated/prisma/client'
import { NoKeyAvailableError } from '@/lib/ai/key-pool'
import { generateJson } from '@/lib/ai/gemini'
import { rankPrompt, type ProfileForPrompt } from '@/lib/ai/prompts'
import { rankBatchSchema, type RankItem } from '@/lib/ai/schemas'
import { db } from '@/lib/db'
import { combineScores, computeRuleScore, type ScoreLine } from '@/lib/ranking/rules'
import type { AppSettings } from '@/lib/settings/schema'
import { chunk } from '@/lib/utils/semaphore'
import { runPool } from '@/lib/utils/pool'
import type { RunLogger } from './logger'

/** AI fit batches in flight at once. */
export const RANK_CONCURRENCY = 3

type JobWithCompany = Prisma.JobGetPayload<{ include: { company: { select: { knownSponsor: true } } } }>

async function saveScore(job: JobWithCompany, ruleScore: number, breakdown: ScoreLine[], llm: RankItem | null, llmWeight: number, model: string | null) {
  const finalScore = combineScores(ruleScore, llm?.fit ?? null, llmWeight)
  const lines: ScoreLine[] = llm
    ? [...breakdown, { label: 'AI fit score', points: Math.round(llm.fit), detail: `weighted ${Math.round(llmWeight * 100)}%` }]
    : breakdown
  await db.jobScore.upsert({
    where: { jobId: job.id },
    update: { ruleScore, llmScore: llm ? Math.round(llm.fit) : null, finalScore, breakdown: lines as unknown as Prisma.InputJsonValue, reasons: llm?.reasons ?? [], gaps: llm?.gaps ?? [], hook: llm?.oneLineHook ?? null, model, scoredAt: new Date() },
    create: { jobId: job.id, ruleScore, llmScore: llm ? Math.round(llm.fit) : null, finalScore, breakdown: lines as unknown as Prisma.InputJsonValue, reasons: llm?.reasons ?? [], gaps: llm?.gaps ?? [], hook: llm?.oneLineHook ?? null, model },
  })
  await db.job.update({ where: { id: job.id }, data: { finalScore } })
  return finalScore
}

/**
 * Rule score for every job, then LLM fit for the survivors (batched, primary model).
 */
export async function rankJobs(
  jobIds: string[],
  settings: AppSettings,
  profile: ProfileForPrompt,
  log: RunLogger,
  shouldStop?: () => Promise<boolean>,
): Promise<{ ranked: number; excluded: number; errors: number }> {
  if (jobIds.length === 0) return { ranked: 0, excluded: 0, errors: 0 }
  const jobs = await db.job.findMany({ where: { id: { in: jobIds } }, include: { company: { select: { knownSponsor: true } } } })
  let ranked = 0
  let excluded = 0
  let errors = 0

  const survivors: Array<{ job: JobWithCompany; ruleScore: number; breakdown: ScoreLine[] }> = []
  for (const job of jobs) {
    const r = computeRuleScore(
      {
        title: job.title,
        description: job.description,
        countryCode: job.countryCode,
        remote: job.remote,
        sponsorship: job.sponsorship,
        seniority: job.seniority,
        requiredLanguages: job.requiredLanguages,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        currency: job.currency,
        relocationSupport: job.relocationSupport,
        postedAt: job.postedAt,
        mustHaveSkills: job.mustHaveSkills,
        tags: job.tags,
        knownSponsor: job.company.knownSponsor,
      },
      { titles: profile.titles, skills: profile.skills, candidate: profile.candidate },
      settings.ranking,
      settings.search,
    )
    if (r.excludedReason) {
      await saveScore(job, 0, r.breakdown, null, settings.ranking.llmWeight, null)
      await db.job.update({ where: { id: job.id }, data: { status: 'REJECTED_RULE', filterReason: r.excludedReason } })
      excluded++
      continue
    }
    survivors.push({ job, ruleScore: r.score, breakdown: r.breakdown })
  }

  type Survivor = (typeof survivors)[number]
  const rankBatch = async (batch: Survivor[]): Promise<{ byId: Map<string, RankItem>; model: string | null }> => {
    const p = rankPrompt(
      profile,
      batch.map(({ job }) => ({
        id: job.id,
        title: job.title,
        company: job.companyName,
        location: job.location,
        countryCode: job.countryCode,
        description: job.description,
        summary: job.summary,
        mustHaveSkills: job.mustHaveSkills,
        sponsorship: job.sponsorship,
        sponsorshipEvidence: job.sponsorshipEvidence,
      })),
    )
    try {
      const r = await generateJson({ task: 'rank', model: settings.ai.rankModel, schema: rankBatchSchema, system: p.system, prompt: p.prompt, temperature: 0.3, maxOutputTokens: 8192 })
      return { byId: new Map(r.data.items.map((i) => [i.id, i])), model: r.model }
    } catch (err) {
      // Out of quota: splitting cannot help, so let the caller stop cleanly.
      if (err instanceof NoKeyAvailableError) throw err
      // Malformed/truncated output: halve the batch and try again before giving up.
      if (batch.length > 2) {
        log.debug(`Rank batch of ${batch.length} failed (${err instanceof Error ? err.message : err}); splitting`)
        const mid = Math.ceil(batch.length / 2)
        const [a, b] = await Promise.all([rankBatch(batch.slice(0, mid)), rankBatch(batch.slice(mid))])
        return { byId: new Map([...a.byId, ...b.byId]), model: a.model ?? b.model }
      }
      throw err
    }
  }

  let quotaGone = false
  let stopLogged = false
  // AI fit batches run side by side (RANK_CONCURRENCY); the AI semaphore still bounds the calls in flight.
  const scoreBatch = async (batch: Survivor[]): Promise<boolean> => {
    if (quotaGone) return false
    let byId = new Map<string, RankItem>()
    let model: string | null = null
    try {
      const r = await rankBatch(batch)
      byId = r.byId
      model = r.model
    } catch (err) {
      if (err instanceof NoKeyAvailableError) {
        // Quota gone: leave these jobs unranked (status NEW, already enriched) so the next run ranks them
        // with the AI fit score instead of storing a rule-only score for good.
        if (!quotaGone) log.info(`Rank: daily AI quota used up after ${ranked} job(s); the rest are ranked on the next run`)
        quotaGone = true
        return false
      }
      log.warn(`Rank batch failed, storing rule-only scores: ${err instanceof Error ? err.message : err}`)
      errors++
    }
    for (const { job, ruleScore, breakdown } of batch) {
      try {
        const llm = byId.get(job.id) ?? null
        await saveScore(job, ruleScore, breakdown, llm, settings.ranking.llmWeight, model)
        await db.job.update({ where: { id: job.id }, data: { status: 'RANKED' } })
        ranked++
      } catch (err) {
        errors++
        log.warn(`Score save failed for ${job.id}: ${err instanceof Error ? err.message : err}`)
      }
    }
    return true
  }

  await runPool(chunk(survivors, settings.ai.rankBatchSize), RANK_CONCURRENCY, scoreBatch, async () => {
    const stop = Boolean(await shouldStop?.())
    if (stop && !stopLogged) {
      stopLogged = true
      log.info('Rank: stopped by user; remaining jobs are ranked on the next run')
    }
    return stop
  })
  return { ranked, excluded, errors }
}
