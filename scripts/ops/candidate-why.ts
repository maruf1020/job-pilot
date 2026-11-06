// Read-only: why are ranked jobs not browser-batch candidates? Mirrors portalCandidates' filters.
process.loadEnvFile(new URL('../../.env', import.meta.url))

async function main() {
  const base = '../../src/lib'
  const { db } = await import(`${base}/db`)
  const { getSettings } = await import(`${base}/settings/service`)
  const { excludedTitleKeyword, mentionsStack } = await import(`${base}/pipeline/prefilter`)
  const { gateEnabled, gateReason } = await import(`${base}/pipeline/quality-gate`)
  const { formTarget } = await import(`${base}/apply/urls`)
  const { hostOf } = await import(`${base}/apply/match`)
  const { findCooldownConflict } = await import(`${base}/pipeline/cooldown`)
  const DONE = ['QUEUED', 'APPROVED', 'SENT', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'SKIPPED', 'NO_RESPONSE']
  const INFLIGHT = ['QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'NEEDS_HUMAN']
  const roleKey = (c: string, t: string) => `${c.toLowerCase()}|${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
  const applied = await db.application.findMany({ where: { OR: [{ sentAt: { not: null } }, { portalStatus: { in: [...INFLIGHT, 'SUBMITTED'] } }] }, select: { job: { select: { companyName: true, title: true } } } })
  const roles = new Set(applied.map((a: { job: { companyName: string; title: string } }) => roleKey(a.job.companyName, a.job.title)))
  const settings = await getSettings()
  const countries = ['IE', 'GB', 'DE', 'NL', 'FR', 'ES', 'PT', 'PL', 'SE', 'DK', 'FI', 'NO', 'BE', 'AT', 'CH', 'IT', 'CZ', 'EE', 'LT', 'LV', 'LU', 'MT', 'CY', 'HU', 'RO', 'BG', 'HR', 'SI', 'SK', 'GR', 'IS']
  const jobs = await db.job.findMany({
    where: { status: { in: ['RANKED', 'REVIEW'] }, finalScore: { gte: 55 }, company: { blacklisted: false }, countryCode: { in: countries }, OR: [{ application: null }, { application: { sentAt: null } }] },
    select: {
      id: true, title: true, description: true, url: true, atsType: true, companyId: true, companyName: true, countryCode: true, finalScore: true, sponsorship: true, salaryMin: true, salaryMax: true, currency: true,
      company: { select: { knownSponsor: true } },
      sourceLinks: { select: { source: true, externalId: true, url: true } },
      application: { select: { status: true, portalStatus: true, _count: { select: { attempts: { where: { status: { in: ['FAILED', 'CANCELLED'] } } } } } } },
    },
  })
  const why: Record<string, number> = {}
  const examples: Record<string, string[]> = {}
  const add = (k: string, j: { companyName: string; title: string; finalScore: number | null }) => {
    why[k] = (why[k] ?? 0) + 1
    const list = (examples[k] ??= [])
    if (list.length < 3) list.push(`${j.finalScore} ${j.companyName} - ${j.title.slice(0, 40)}`)
  }
  for (const j of jobs) {
    const t = formTarget(j, j.sourceLinks)
    if (j.application && ['QUEUED', 'APPROVED', 'SENT'].includes(j.application.status)) add(`email ${j.application.status.toLowerCase()}`, j)
    else if ((j.application?._count.attempts ?? 0) >= 2) add('tried twice already', j)
    else if (excludedTitleKeyword(j.title, settings.search.excludeTitleKeywords)) add('excluded title word', j)
    else if (!mentionsStack(`${j.title}\n${j.description}`, settings.portal.stackFocus)) add('outside the stack focus', j)
    else if (/(^|\.)adzuna\./i.test(hostOf(t.url))) add('adzuna (region-blocked)', j)
    else if (gateEnabled(settings.email) && gateReason(j)) add(`gate: ${gateReason(j)!.split(':')[0].slice(0, 40)}`, j)
    else if (j.application && DONE.includes(j.application.status)) add(`application ${j.application.status.toLowerCase()}`, j)
    else if (j.application && INFLIGHT.includes(j.application.portalStatus ?? '')) add(`website attempt ${(j.application.portalStatus ?? '').toLowerCase()} (waiting for you)`, j)
    else if (roles.has(roleKey(j.companyName, j.title))) add('same role already applied (other country)', j)
    else if (await findCooldownConflict({ companyId: j.companyId, countryCode: j.countryCode, toEmail: null }, settings.email)) add('company applied to within the cooldown', j)
    else add(`READY (site ${t.site})`, j)
  }
  console.log(`ranked jobs >= 55 in Europe, not yet sent: ${jobs.length}`)
  for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${k}  e.g. ${examples[k].join(' | ')}`)
  await db.$disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
