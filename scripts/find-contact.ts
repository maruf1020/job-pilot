/**
 * Look up (and verify) an application email for one company from the terminal.
 *
 *   npx tsx scripts/find-contact.ts "Acme Ltd"          # by name (case-insensitive contains)
 *   npx tsx scripts/find-contact.ts acme.ie             # by domain
 *   npx tsx scripts/find-contact.ts cmf...              # by id
 *   npx tsx scripts/find-contact.ts acme.ie --no-verify # skip the SMTP probe
 */
process.loadEnvFile('.env')

async function main() {
  const { db } = await import('@/lib/db')
  const { discoverContactForCompany } = await import('@/lib/pipeline/contacts')
  const { createRunLogger } = await import('@/lib/pipeline/logger')

  const args = process.argv.slice(2)
  const needle = args.find((a) => !a.startsWith('--'))
  if (!needle) {
    console.error('usage: tsx scripts/find-contact.ts <company name | id | domain> [--no-verify]')
    process.exit(1)
  }
  const company =
    (await db.company.findUnique({ where: { id: needle } })) ??
    (await db.company.findFirst({ where: { OR: [{ domain: { equals: needle, mode: 'insensitive' } }, { name: { contains: needle, mode: 'insensitive' } }] }, orderBy: { name: 'asc' } }))
  if (!company) {
    console.error(`No company matches "${needle}"`)
    process.exit(1)
  }
  console.log(`Company: ${company.name} (${company.domain ?? 'no domain'}) — current: ${company.contactEmail ?? 'none'} [${company.contactEmailSource ?? '-'}]`)
  const started = Date.now()
  const r = await discoverContactForCompany(company.id, { force: true, skipVerify: args.includes('--no-verify'), log: createRunLogger(null, 'find-contact') })
  console.log(`\nResult after ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`  email:        ${r.email ?? 'none'}`)
  console.log(`  source:       ${r.source ?? '-'}`)
  console.log(`  domain:       ${r.domain ?? '-'}`)
  console.log(`  fallbacks:    ${r.candidates.length ? r.candidates.join(', ') : '-'}`)
  console.log(`  jobs updated: ${r.jobsUpdated}`)
  console.log('  notes:')
  for (const n of r.notes) console.log(`    - ${n}`)
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
