/**
 * Execute one full search run in-process (no worker needed). Usage:
 *   npx tsx scripts/run-once.ts [--skip-drafts] [--skip-discovery] [--sources=arbeitnow,ats]
 */
process.loadEnvFile('.env')

async function main() {
  const { executeSearchRun } = await import('@/lib/pipeline/run')
  const { db } = await import('@/lib/db')
  const args = process.argv.slice(2)
  const skipDrafts = args.includes('--skip-drafts')
  const skipDiscovery = args.includes('--skip-discovery')
  const sourcesArg = args.find((a) => a.startsWith('--sources='))
  const sources = sourcesArg ? (sourcesArg.slice('--sources='.length).split(',') as Parameters<typeof executeSearchRun>[1] extends { sources?: infer S } ? S : never) : undefined
  const started = Date.now()
  const runId = await executeSearchRun('MANUAL', { skipDrafts, skipDiscovery, sources })
  const run = await db.searchRun.findUniqueOrThrow({ where: { id: runId }, include: { sources: true } })
  console.log(`\nRun ${runId}: ${run.status} in ${Math.round((Date.now() - started) / 1000)}s`)
  console.log({ fetched: run.totalFetched, new: run.totalNew, duplicates: run.totalDuplicates, filtered: run.totalFiltered, enriched: run.totalEnriched, ranked: run.totalRanked, drafted: run.totalDrafted, queued: run.totalQueued, errors: run.errorCount })
  for (const s of run.sources) console.log(`  ${s.source.padEnd(12)} ${(s.query ?? '').padEnd(28)} ${(s.country ?? '').padEnd(3)} req=${s.requests} ret=${s.returned} new=${s.created} dup=${s.duplicates} err=${s.errors} ${s.error ?? ''}`)
  await db.$disconnect()
  process.exit(run.status === 'FAILED' ? 1 : 0)
}

void main()

export {}
