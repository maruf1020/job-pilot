// Start a company contact lookup now (same as Contacts -> Find emails), so more jobs get a real address.
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { createContactBatch } = await import('../../src/lib/pipeline/contact-batch')
  const { enqueueContactBatch } = await import('../../src/lib/queue')
  const run = await createContactBatch('above_threshold', 10, false)
  await enqueueContactBatch({ runId: run.id, includeChecked: false })
  console.log(`contact lookup ${run.id}: ${run.total} companies`)
  process.exit(0)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
