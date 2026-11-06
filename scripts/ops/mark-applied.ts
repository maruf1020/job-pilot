// Record applications as sent through the website, with the evidence. Args: attemptSuffix=evidence ...
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { db } = await import('../../src/lib/db')
  const { markSubmittedByHand } = await import('../../src/lib/apply/service')
  for (const arg of process.argv.slice(2)) {
    const [suffix, evidence] = arg.split('=')
    const a = await db.portalAttempt.findFirst({ where: { id: { endsWith: suffix } }, include: { application: { include: { job: { select: { companyName: true } } } } } })
    if (!a) { console.log(`${suffix}: not found`); continue }
    await markSubmittedByHand(a.applicationId, null, { formUrl: a.formUrl, finalUrl: a.finalUrl, atsType: a.atsType, confirmation: evidence })
    await db.portalAttempt.update({ where: { id: a.id }, data: { status: 'SUBMITTED', needsHumanReason: null, tabId: null } })
    console.log(`${suffix}: ${a.application.job.companyName} recorded as applied`)
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
