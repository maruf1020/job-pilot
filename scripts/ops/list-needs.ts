// Forms the AI left for a person that an agent can finish: target titles first, newest first.
// Skips CAPTCHAs, emailed codes and sign-ins (those wait for the person). Args: [limit] [--all-titles] [--other]
process.loadEnvFile(new URL('../../.env', import.meta.url))
async function main() {
  const { db } = await import('../../src/lib/db')
  const { titleMatchesTarget } = await import('../../src/lib/candidate/professions')
  const { getSettings } = await import('../../src/lib/settings/service')
  const { search } = await getSettings()
  // "Target" = the profession and target titles from Settings > Search.
  const isTarget = (title: string) => titleMatchesTarget(title, search.targetTitles, search.profession)
  const limit = Number(process.argv[2]) || 10
  const all = process.argv.includes('--all-titles')
  const rows = await db.portalAttempt.findMany({
    where: { status: 'NEEDS_HUMAN', application: { portalStatus: { notIn: ['SUBMITTED', 'CANCELLED'] }, submittedVia: null } },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, applicationId: true, error: true, needsHumanReason: true, formUrl: true, finalUrl: true, startUrl: true, atsType: true, tabId: true, application: { select: { job: { select: { title: true, companyName: true, url: true } } } } },
  })
  const HUMAN_ONLY = /captcha|code it emailed|verification code|sign in|log in|sign-in|password|account/i
  // One entry per application: older attempts repeat the same form.
  const seenApp = new Set<string>()
  const firstForApp = (id: string) => (seenApp.has(id) ? false : (seenApp.add(id), true))
  const pick = rows
    .filter((r) => !HUMAN_ONLY.test(`${r.error ?? ''} ${r.needsHumanReason ?? ''}`) && firstForApp(r.applicationId))
    .map((r) => ({ r, se: isTarget(r.application.job.title) }))
    .filter((x) => (process.argv.includes('--other') ? !x.se : all || x.se))
    // Two agents on one list: `--half a` / `--half b` split it by attempt id, so they never take the same form.
    .filter((x) => {
      const i = process.argv.indexOf('--half')
      if (i < 0) return true
      const odd = x.r.id.charCodeAt(x.r.id.length - 1) % 2 === 1
      return process.argv[i + 1] === 'a' ? odd : !odd
    })
    // Forms left open in the browser first (the person sees them waiting), then target titles.
    .sort((a, b) => Number(Boolean(b.r.tabId)) - Number(Boolean(a.r.tabId)) || Number(b.se) - Number(a.se))
    .slice(0, limit)
  for (const { r } of pick) {
    const url = r.finalUrl ?? r.formUrl ?? r.startUrl ?? r.application.job.url
    console.log([r.id.slice(-6), r.application.job.companyName, r.application.job.title.slice(0, 60), r.atsType ?? '?', r.tabId ? 'tab-open' : 'no-tab', url, (r.needsHumanReason ?? r.error ?? '').slice(0, 160)].join(' | '))
  }
  console.log(`total waiting ${rows.length}; listed ${pick.length}`)
  process.exit(0)
}
main()
