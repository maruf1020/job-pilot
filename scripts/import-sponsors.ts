/**
 * Import the official sponsor registers and mark matching companies as known sponsors.
 *   npx tsx scripts/import-sponsors.ts            # IE, GB and NL
 *   npx tsx scripts/import-sponsors.ts IE NL
 */
process.loadEnvFile('.env')

async function main() {
  const { importRegisters, applyRegistersToCompanies, registerSummary, REGISTER_COUNTRIES } = await import('@/lib/sponsors/registers')
  const { db } = await import('@/lib/db')
  const wanted = process.argv.slice(2).map((a) => a.toUpperCase()).filter((a): a is 'IE' | 'GB' | 'NL' => (REGISTER_COUNTRIES as string[]).includes(a))
  const countries = wanted.length ? wanted : REGISTER_COUNTRIES
  console.log(`importing ${countries.join(', ')} …`)
  const started = Date.now()
  const { results, errors } = await importRegisters(countries)
  for (const r of results) console.log(`  ${r.country}: ${r.rows.toLocaleString()} employers from "${r.source}" (${r.skipped} skipped)`)
  for (const e of errors) console.log(`  ${e.country}: FAILED ${e.error}`)
  const applied = await applyRegistersToCompanies()
  console.log(`matched: ${applied.matched} newly marked as sponsors, ${applied.alreadyKnown} already known (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  console.table(await registerSummary())
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
