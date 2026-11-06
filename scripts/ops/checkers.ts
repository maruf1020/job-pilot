// The 10-minute checkers under the supervisor: one per area, each prints OK or WARN with a short reason.
// 1 apply (the AI applying), 2 find (job search), 3 email (sending), 4 next-step (new replies), 5 ai (API).
process.loadEnvFile(new URL('../../.env', import.meta.url))

async function main() {
  const { db } = await import('../../src/lib/db')
  const { getAiUsageSummary } = await import('../../src/lib/ai/usage')
  const { generateText } = await import('../../src/lib/ai/gemini')
  const min = (n: number) => new Date(Date.now() - n * 60_000)
  const out: string[] = []
  const say = (area: string, ok: boolean, msg: string) => out.push(`${ok ? 'OK  ' : 'WARN'} ${area.padEnd(9)} ${msg}`)

  // 1. Applying: batch alive, attempts moving, nothing stuck.
  const batch = await db.portalBatch.findFirst({ where: { status: 'RUNNING' } })
  const recent = await db.portalAttempt.groupBy({ by: ['status'], where: { updatedAt: { gte: min(10) } }, _count: true })
  const live = await db.portalAttempt.groupBy({ by: ['status'], where: { status: { in: ['RUNNING', 'QUEUED'] } }, _count: true })
  const stuck = await db.portalAttempt.count({ where: { status: 'RUNNING', startedAt: { lt: min(30) } } })
  const subToday = await db.portalAttempt.count({ where: { status: 'SUBMITTED', finishedAt: { gte: min(24 * 60) } } })
  const fmt = (g: Array<{ status: string; _count: number }>) => g.map((r) => `${r.status} ${r._count}`).join(', ') || 'none'
  const paused = batch?.nextAttemptAt && batch.nextAttemptAt > new Date(Date.now() + 60 * 60_000)
  say('apply', Boolean(batch) && !paused && stuck === 0,
    `${batch ? `batch ${batch.id.slice(-6)} submitted ${batch.submitted}${batch.waitingFor ? ` (${batch.waitingFor.slice(0, 70)})` : ''}${paused ? ' PAUSED' : ''}` : 'NO RUNNING BATCH'}; last 10m: ${fmt(recent)}; now: ${fmt(live)}; stuck>30m ${stuck}; submitted 24h ${subToday}`)

  // 2. Finding jobs: a search ran in the last ~2.5 h and is not hanging.
  const run = await db.searchRun.findFirst({ orderBy: { startedAt: 'desc' } })
  const beatAge = run?.heartbeatAt ? Math.round((Date.now() - run.heartbeatAt.getTime()) / 60_000) : null
  const sinceStart = run ? Math.round((Date.now() - run.startedAt.getTime()) / 60_000) : null
  const findOk = Boolean(run) && (run!.status === 'RUNNING' ? (beatAge ?? 99) < 6 : (sinceStart ?? 999) < 150 && run!.status !== 'FAILED')
  say('find', findOk, run ? `last search ${run.status} started ${sinceStart}m ago, heartbeat ${beatAge}m ago, new ${run.totalNew}, ranked ${run.totalRanked}` : 'no search run yet')

  // 3. Email: sends in the last 10 min, waiting queue, recent bounces, off-rule titles.
  const sent = await db.application.findMany({ where: { sentAt: { gte: min(10) } }, select: { channel: true, bounceCount: true, job: { select: { title: true } } } })
  const queued = await db.application.count({ where: { status: { in: ['QUEUED', 'APPROVED'] }, sentAt: null } })
  const bounces = await db.emailMessage.count({ where: { direction: 'INBOUND', classification: 'BOUNCE', createdAt: { gte: min(60) } } })
  const outHour = await db.emailMessage.count({ where: { direction: 'OUTBOUND', createdAt: { gte: min(60) } } })
  const emails = sent.filter((s) => s.channel === 'email')
  say('email', bounces <= Math.max(2, outHour * 0.15), `sent 10m ${emails.length} (${emails.map((s) => s.job.title.slice(0, 30) + (s.bounceCount ? ' [resend]' : '')).join('; ') || '-'}); queued ${queued}; sent 1h ${outHour}, bounces 1h ${bounces}`)

  // 4. Next steps: replies the app classified as interview / more info / positive / location in the last 10 min.
  const news = await db.emailMessage.findMany({
    where: { direction: 'INBOUND', classification: { in: ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO', 'LOCATION_ISSUE'] }, createdAt: { gte: min(10) } },
    select: { classification: true, fromAddress: true, subject: true },
  })
  const portalNews = await db.inboxMessage.findMany({ where: { kind: { in: ['interview', 'needs_info', 'location_issue'] }, createdAt: { gte: min(10) } }, select: { kind: true, fromAddress: true, subject: true } })
  const items = [...news.map((n) => `${n.classification}: ${n.subject.slice(0, 60)}`), ...portalNews.map((n) => `${n.kind}: ${n.subject.slice(0, 60)}`)]
  say('nextstep', true, items.length ? `NEW ${items.length}: ${items.join(' | ')}` : 'no new next-step or location replies')

  // 6. Finding emails: company contact discovery (AI + search) keeps running.
  const cdr = await db.contactDiscoveryRun.findFirst({ orderBy: { startedAt: 'desc' } })
  const contacts24h = await db.job.count({ where: { contactEmail: { not: null }, updatedAt: { gte: min(24 * 60) } } })
  const cdrAge = cdr ? Math.round((Date.now() - cdr.startedAt.getTime()) / 60_000) : null
  say('contacts', Boolean(cdr) && cdr!.status !== 'FAILED', cdr ? `last discovery ${cdr.status} ${cdrAge}m ago (found ${cdr.found}, verified ${cdr.verified}, guessed ${cdr.guessed}); jobs with an email updated 24h ${contacts24h}` : 'no contact discovery yet')

  // 7. Preparing documents: drafts (cover letters / emails) the AI wrote and what waits for review.
  const drafts1h = await db.emailDraft.count({ where: { createdAt: { gte: min(60) } } })
  const passed1h = await db.emailDraft.count({ where: { createdAt: { gte: min(60) }, passed: true } })
  const review = await db.application.count({ where: { status: { in: ['DRAFT', 'REVIEW'] } } })
  say('documents', true, `drafts written 1h ${drafts1h} (passed checks ${passed1h}); applications waiting in draft/review ${review}`)

  // 5. AI: one tiny live call through the key pool, quota left, error rate today.
  let ping = 'ok'
  try {
    const r = await generateText({ task: 'classify_reply', model: 'lite', prompt: 'Reply with the single word OK.', maxOutputTokens: 256 } as never)
    if (!String((r as { text?: string }).text ?? r).toUpperCase().includes('OK')) ping = 'odd answer'
  } catch (err) {
    ping = `FAILED ${err instanceof Error ? err.message.slice(0, 90) : err}`
  }
  const u = await getAiUsageSummary()
  say('ai', ping === 'ok' && u.liteRemaining > 20, `ping ${ping}; provider ${u.provider}; calls today ${u.totalCalls}, errors ${u.totalErrors}; lite left ${u.liteRemaining}, primary left ${u.primaryRemaining}`)

  console.log(`${new Date().toISOString().slice(0, 16)}Z\n${out.join('\n')}`)
  process.exit(0)
}
main()
