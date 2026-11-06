process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { enqueueSearchRun } = await import('../../src/lib/queue')
  console.log('search run queued:', await enqueueSearchRun({ trigger: 'MANUAL' }))
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
