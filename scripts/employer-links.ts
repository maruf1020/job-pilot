// Resolve board-only postings (Adzuna, Jooble, Jobicy...) to the employer's own form, outside a run.
// Usage: npx tsx scripts/employer-links.ts [limit=400] [minScore=55]
process.loadEnvFile('.env')
async function main() {
  const { resolveEmployerLinks } = await import('../src/lib/pipeline/employer-links')
  const limit = Number(process.argv[2] ?? 400)
  const minScore = Number(process.argv[3] ?? 55)
  const r = await resolveEmployerLinks({ limit, minScore, log: (m) => console.log(m) })
  console.log(JSON.stringify(r))
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })

export {}
