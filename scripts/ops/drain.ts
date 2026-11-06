// Pause (or resume) new claims on the running batch, so the worker can restart between attempts.
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { db } = await import('../../src/lib/db')
  const resume = process.argv[2] === 'resume'
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' } })
  if (!batch) return console.log('no running batch')
  await db.portalBatch.update({ where: { id: batch.id }, data: resume ? { nextAttemptAt: null, waitingFor: null } : { nextAttemptAt: new Date(Date.now() + 40 * 60_000), waitingFor: process.argv[3] ?? 'Restarting the worker to load fixes' } })
  console.log(batch.id.slice(-6), resume ? 'resumed' : 'paused new claims')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
