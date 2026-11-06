process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { portalCandidates } = await import('../../src/lib/apply/portal-batch')
  const sites = ['greenhouse','ashby','lever','workable','smartrecruiters','recruitee','teamtailor','personio','linkedin','other'] as never
  for (const minScore of (process.argv[2] ? process.argv[2].split(",").map(Number) : [60, 50, 40])) {
    const c = await portalCandidates({ minScore, countries: [], sites }, 300)
    console.log(`minScore ${minScore}: ${c.length} eligible now`)
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
