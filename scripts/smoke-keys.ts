// Live check of the keyed job sources (credentials from Settings, else .env). Usage: npx tsx scripts/smoke-keys.ts
process.loadEnvFile('.env')
async function main() {
  const { joobleAdapter } = await import('@/lib/sources/jooble')
  const { adzunaAdapter } = await import('@/lib/sources/adzuna')
  const { jsearchAdapter } = await import('@/lib/sources/jsearch')
  const { DEFAULT_SEARCH } = await import('@/lib/settings/schema')
  const { sourceCredentials } = await import('@/lib/keys/service-keys')
  const ctx = {
    search: DEFAULT_SEARCH,
    env: await sourceCredentials(),
    fetch: globalThis.fetch,
    log: (l: string, m: string) => console.log(`  [${l}] ${m}`),
  }
  const cases = [
    { a: joobleAdapter, p: { query: 'software engineer', countryCode: 'IE', maxDaysOld: 30, page: 1 } },
    { a: adzunaAdapter, p: { query: 'software engineer', countryCode: 'DE', maxDaysOld: 30, page: 1 } },
    { a: jsearchAdapter, p: { query: 'software engineer', countryCode: 'IE', maxDaysOld: 30, page: 1 } },
  ]
  for (const { a, p } of cases) {
    console.log(`\n=== ${a.id} (configured=${a.isConfigured(ctx)}) ===`)
    if (!a.isConfigured(ctx)) continue
    const started = Date.now()
    try {
      const r = await a.fetch(p, ctx)
      console.log(`${r.jobs.length} jobs, hasMore=${r.hasMore}, ${Date.now() - started}ms`)
      for (const j of r.jobs.slice(0, 4)) console.log(`  - ${j.title} @ ${j.company} [${j.countryCode ?? '??'}] ${j.location ?? ''} desc=${j.description.length}ch salary=${j.salaryMin ?? '-'} email=${j.contactEmail ?? '-'}`)
    } catch (e) {
      console.log(`FAILED: ${e instanceof Error ? e.message : e}`)
    }
  }
  process.exit()
}
void main()

export {}
