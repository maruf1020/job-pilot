// Recompute the rule part of every ranked job's score with today's rules and settings (no AI calls):
// the stored AI fit score is kept, the final score is combined again, and jobs the rules now exclude
// become REJECTED_RULE (only when no application was sent). Usage: npx tsx scripts/rescore-rules.ts [--write]
process.loadEnvFile('.env')
async function main() {
  const write = process.argv.includes('--write')
  const { db } = await import('../src/lib/db')
  const { getSettings } = await import('../src/lib/settings/service')
  const { getProfile } = await import('../src/lib/pipeline/profile')
  const { loadCandidateContext } = await import('../src/lib/candidate/load')
  const { combineScores, computeRuleScore } = await import('../src/lib/ranking/rules')
  const settings = await getSettings()
  const profile = await getProfile()
  if (!profile) throw new Error('No candidate profile')
  const candidate = await loadCandidateContext({ fresh: true })
  const jobs = await db.job.findMany({
    where: { status: { in: ['RANKED', 'REVIEW'] }, score: { isNot: null } },
    include: { company: { select: { knownSponsor: true } }, score: true, application: { select: { sentAt: true, portalStatus: true } } },
  })
  let changed = 0
  let excluded = 0
  let up = 0
  let down = 0
  for (const job of jobs) {
    const s = job.score!
    const r = computeRuleScore(
      { title: job.title, description: job.description, countryCode: job.countryCode, remote: job.remote, sponsorship: job.sponsorship, seniority: job.seniority, requiredLanguages: job.requiredLanguages, salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency, relocationSupport: job.relocationSupport, postedAt: job.postedAt, mustHaveSkills: job.mustHaveSkills, tags: job.tags, knownSponsor: job.company.knownSponsor },
      { titles: profile.titles, skills: profile.skills, candidate },
      settings.ranking,
      settings.search,
    )
    const busy = Boolean(job.application?.sentAt) || ['QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'NEEDS_HUMAN', 'SUBMITTED'].includes(job.application?.portalStatus ?? '')
    if (r.excludedReason && !busy) {
      excluded++
      if (write) {
        await db.jobScore.update({ where: { id: s.id }, data: { ruleScore: 0, finalScore: 0 } })
        await db.job.update({ where: { id: job.id }, data: { status: 'REJECTED_RULE', filterReason: r.excludedReason, finalScore: 0 } })
      }
      continue
    }
    const final = combineScores(r.score, s.llmScore, settings.ranking.llmWeight)
    if (final === s.finalScore && r.score === s.ruleScore) continue
    changed++
    if (final > s.finalScore) up++
    else if (final < s.finalScore) down++
    if (!write) continue
    const lines = s.llmScore != null ? [...r.breakdown, { label: 'AI fit score', points: s.llmScore, detail: `weighted ${Math.round(settings.ranking.llmWeight * 100)}%` }] : r.breakdown
    await db.jobScore.update({ where: { id: s.id }, data: { ruleScore: r.score, finalScore: final, breakdown: lines as never } })
    await db.job.update({ where: { id: job.id }, data: { finalScore: final } })
  }
  console.log(`${jobs.length} ranked jobs: ${changed} rescored (${up} up, ${down} down), ${excluded} now excluded by rules${write ? '' : ' (dry run; --write to save)'}`)
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })

export {}
