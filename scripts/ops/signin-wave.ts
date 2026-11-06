// Sign-in wave: the jobs waiting in "Needs you" for a sign-in open one site at a
// time in your Chrome with "Open with AI". You sign in (or create the account) on the first job of a site;
// the AI fills and submits, and the site's other jobs follow by themselves on the saved login. A site you
// do not sign in to within the attempt's 10 minutes is skipped. Checks every 30 s. Run in the background:
//   npx tsx scripts/ops/signin-wave.ts            (all sites, biggest first)
//   npx tsx scripts/ops/signin-wave.ts --dry      (list only)
process.loadEnvFile(new URL('../../.env', import.meta.url))

const SIGN_IN = /sign[ -]?in|log[ -]?in|account|register|password/i
const ACTIVE = ['QUEUED', 'RUNNING']

async function main() {
  const dry = process.argv.includes('--dry')
  const { db } = await import('../../src/lib/db')
  const { queuePortalAttempt } = await import('../../src/lib/apply/service')
  const log = (m: string) => console.log(`[signin-wave ${new Date().toISOString().slice(11, 19)}] ${m}`)

  const rows = await db.$queryRaw<Array<{ id: string; host: string; company: string; title: string }>>`
    with last as (
      select distinct on (p."applicationId") p."applicationId", p."needsHumanReason" r, coalesce(p."finalUrl", p."startUrl") u
      from "PortalAttempt" p
      -- A worker restart cancels queued tries; the reason that counts is the one before it.
      where coalesce(p.error, '') not like 'Worker restarted%' and coalesce(p."needsHumanReason", '') not like 'Worker restarted%'
      order by p."applicationId", p."startedAt" desc)
    select a.id, regexp_replace(l.u, '^https?://([^/]+).*$', '\\1') host, j."companyName" company, j.title
    from "Application" a join last l on l."applicationId" = a.id join "Job" j on j.id = a."jobId"
    where a.status = 'NEEDS_HUMAN' and l.r ~* '(sign[ -]?in|log[ -]?in|account|register|password)' and l.r !~* 'captcha'
    order by a."createdAt"`
  // SuccessFactors, Taleo, Workday and the like hold one account per company, not per address.
  const keyOf = (r: (typeof rows)[number]) => (/successfactors|sapsf|taleo|myworkday|eightfold/i.test(r.host) ? `${r.host} (${r.company})` : r.host)
  const byHost = new Map<string, typeof rows>()
  for (const r of rows) byHost.set(keyOf(r), [...(byHost.get(keyOf(r)) ?? []), r])
  const hosts = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length)
  log(`${rows.length} jobs on ${hosts.length} sites wait for a sign-in`)
  if (dry) {
    for (const [h, list] of hosts) log(`${h}: ${list.map((r) => r.company).join(', ')}`)
    process.exit(0)
  }

  // Only single "Open with AI" runs share your Chrome; batch agents work in their own browser.
  const busy = async () => (await db.portalAttempt.count({ where: { status: { in: ACTIVE }, batchId: null } })) > 0
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  /** Queue one job and wait for its attempt to end; null when it could not be queued. */
  const run = async (r: (typeof rows)[number]) => {
    while (await busy()) await sleep(30_000)
    const attempt = await queuePortalAttempt(r.id, 'submit', { interactive: true }).catch((err: unknown) => {
      log(`${r.company}: not queued (${err instanceof Error ? err.message.slice(0, 120) : err})`)
      return null
    })
    if (!attempt) return null
    log(`${r.host}: ${r.title} at ${r.company} is open in your Chrome`)
    for (;;) {
      await sleep(30_000)
      const a = await db.portalAttempt.findUnique({ where: { id: attempt.id }, select: { status: true, needsHumanReason: true, error: true } })
      if (a && !ACTIVE.includes(a.status)) {
        log(`${r.company}: ${a.status}${a.needsHumanReason || a.error ? ` - ${(a.needsHumanReason ?? a.error ?? '').slice(0, 140)}` : ''}`)
        return a
      }
    }
  }

  for (const [host, list] of hosts) {
    let signedIn = false
    for (const r of list) {
      const a = await run(r)
      if (!a) continue
      // Still stuck on the sign-in: you were not there for this site, so its other jobs wait too.
      const stillWall = a.status === 'NEEDS_HUMAN' && SIGN_IN.test(a.needsHumanReason ?? '')
      if (stillWall && !signedIn) {
        log(`${host}: nobody signed in; the site's ${list.length - 1} other job(s) stay in Needs you`)
        break
      }
      signedIn = signedIn || !stillWall
    }
  }
  log('done: every site had its turn')
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
