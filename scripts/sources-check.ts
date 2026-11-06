/**
 * Live check of every job source: one small request each, printed as a table.
 *   npx tsx scripts/sources-check.ts            # all configured sources
 *   npx tsx scripts/sources-check.ts eures linkedin
 *   npx tsx scripts/sources-check.ts adzuna themuse --country=US --outside=CA,AU,US
 * Keyed sources without a key are reported as "not configured". Nothing is written to the database.
 * --country asks country sources for that country; --outside switches on countries outside Europe.
 */
process.loadEnvFile('.env')

async function main() {
  const { sourceCredentials } = await import('@/lib/keys/service-keys')
  const { SOURCE_ADAPTERS, SOURCE_ORDER } = await import('@/lib/sources/registry')
  const { DEFAULT_SEARCH } = await import('@/lib/settings/schema')
  const { SOURCE_IDS } = await import('@/lib/domain')
  const only = process.argv.slice(2).filter((a) => (SOURCE_IDS as readonly string[]).includes(a))
  const flag = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const askCountry = flag('country')?.toUpperCase()
  const outside = (flag('outside') ?? '').split(',').map((c) => c.trim().toUpperCase()).filter((c) => ['CA', 'AU', 'US', 'NZ'].includes(c)) as Array<'CA' | 'AU' | 'US' | 'NZ'>
  const ctx = {
    search: { ...DEFAULT_SEARCH, outsideEurope: outside },
    env: await sourceCredentials(),
    fetch: globalThis.fetch,
    log: (level: string, message: string) => console.log(`    [${level}] ${message}`),
    atsCompanies: [],
    scrapeTargets: [],
  }
  const rows: Array<{ source: string; status: string; jobs: number; sample: string; ms: number }> = []
  for (const id of SOURCE_ORDER) {
    if (only.length && !only.includes(id)) continue
    if (id === 'scrape' || id === 'ats') continue
    const adapter = SOURCE_ADAPTERS[id]
    if (!adapter.isConfigured(ctx as never)) {
      rows.push({ source: id, status: 'not configured', jobs: 0, sample: '', ms: 0 })
      continue
    }
    const started = Date.now()
    try {
      const country = askCountry ?? (adapter.supportedCountries ? [...adapter.supportedCountries][0] : 'IE')
      if (askCountry && adapter.usesCountry && adapter.supportedCountries && !adapter.supportedCountries.has(askCountry)) {
        rows.push({ source: id, status: `does not serve ${askCountry}`, jobs: 0, sample: '', ms: 0 })
        continue
      }
      const r = await adapter.fetch({ query: 'software engineer', countryCode: adapter.usesCountry ? country : undefined, maxDaysOld: 30, page: 1 }, ctx as never)
      const s = r.jobs[0]
      const countries = [...new Set(r.jobs.map((j) => j.countryCode ?? '?'))].slice(0, 8).join(' ')
      if (countries) console.log(`  ${id}: countries ${countries}`)
      rows.push({ source: id, status: 'ok', jobs: r.jobs.length, sample: s ? `${s.title} @ ${s.company} (${s.countryCode ?? s.location ?? '?'})`.slice(0, 70) : '', ms: Date.now() - started })
    } catch (err) {
      rows.push({ source: id, status: `error: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`, jobs: 0, sample: '', ms: Date.now() - started })
    }
  }
  console.table(rows)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
