/**
 * Give every company without a board the board its postings point to (plan-apply-all.md 8.2),
 * then mark companies found on the sponsor registers by the looser name match.
 *   npx tsx scripts/boards-backfill.ts             # writes Company board fields
 *   npx tsx scripts/boards-backfill.ts --dry-run   # only counts
 *   npx tsx scripts/boards-backfill.ts --registers # also re-apply the sponsor registers to companies
 * Only Company rows change; jobs, applications and settings are not touched.
 */
process.loadEnvFile('.env')

async function main() {
  const { db } = await import('@/lib/db')
  const { dominantBoard, registerBoardsFromJobs } = await import('@/lib/sponsors/board-registry')
  const dry = process.argv.includes('--dry-run')
  const before = await db.company.groupBy({ by: ['atsType'], _count: { _all: true } })
  console.log('Boards before:', Object.fromEntries(before.map((g) => [g.atsType ?? 'none', g._count._all])))

  if (dry) {
    const companies = await db.company.findMany({ where: { atsType: null, blacklisted: false }, select: { id: true, jobs: { select: { url: true, sourceLinks: { select: { url: true } } }, take: 50 } } })
    const counts: Record<string, number> = {}
    for (const c of companies) {
      const ref = dominantBoard(c.jobs.flatMap((j) => [j.url, ...j.sourceLinks.map((l) => l.url)]))
      if (ref) counts[ref.atsType] = (counts[ref.atsType] ?? 0) + 1
    }
    console.log(`Dry run: ${companies.length} companies without a board; would register`, counts)
  } else {
    const r = await registerBoardsFromJobs({ log: (m) => console.log(m) })
    console.log(`Checked ${r.companies} companies without a board; registered ${r.registered}`, r.byType)
  }

  if (process.argv.includes('--registers') && !dry) {
    const { applyRegistersToCompanies } = await import('@/lib/sponsors/registers')
    const m = await applyRegistersToCompanies()
    console.log(`Sponsor registers: ${m.matched} more companies marked as known sponsors (${m.alreadyKnown} already were)`)
  }

  const after = await db.company.groupBy({ by: ['atsType'], _count: { _all: true } })
  console.log('Boards after:', Object.fromEntries(after.map((g) => [g.atsType ?? 'none', g._count._all])))
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)

export {}
