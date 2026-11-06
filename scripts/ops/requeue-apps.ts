// Re-queue held applications (one application id per line in the file) in submit mode, in your Chrome.
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const fs = await import('node:fs')
  const { queuePortalAttempt } = await import('../../src/lib/apply/service')
  const ids = [...new Set(fs.readFileSync(process.argv[2], 'utf8').split(/\s+/).filter(Boolean))]
  let ok = 0
  for (const id of ids) {
    try {
      await queuePortalAttempt(id, 'submit', { interactive: true })
      ok++
    } catch (e) {
      console.log(`${id.slice(-6)}: ${(e as Error).message}`)
    }
  }
  console.log(`re-queued ${ok} of ${ids.length}`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
