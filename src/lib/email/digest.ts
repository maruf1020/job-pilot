import { getAiUsageSummary } from '@/lib/ai/usage'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { getSettings } from '@/lib/settings/service'
import { deliver } from './send'

/** Compose and send the daily digest email to myself. */
export async function sendDailyDigest(log: (m: string) => void = console.log): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.digestEnabled) return false
  const user = await db.user.findFirst({ select: { email: true } })
  const to = settings.digestEmail ?? user?.email
  if (!to) return false
  const since = new Date(Date.now() - 24 * 3600 * 1000)

  const [newTop, awaiting, replies, queued, usage, lastRun] = await Promise.all([
    db.job.findMany({
      where: { status: { in: ['RANKED', 'REVIEW', 'DRAFTING'] }, firstSeenAt: { gte: since }, score: { finalScore: { gte: settings.ranking.draftThreshold } } },
      orderBy: { score: { finalScore: 'desc' } },
      take: 10,
      select: { title: true, companyName: true, countryCode: true, url: true, score: { select: { finalScore: true } } },
    }),
    db.application.findMany({ where: { status: { in: ['REVIEW', 'NEEDS_HUMAN'] } }, take: 15, include: { job: { select: { title: true, companyName: true } } } }),
    db.emailMessage.findMany({ where: { direction: 'INBOUND', createdAt: { gte: since } }, include: { application: { include: { job: { select: { title: true, companyName: true } } } } } }),
    db.application.findMany({ where: { status: 'QUEUED' }, orderBy: { scheduledFor: 'asc' }, take: 10, include: { job: { select: { title: true, companyName: true } } } }),
    getAiUsageSummary(),
    db.searchRun.findFirst({ orderBy: { startedAt: 'desc' } }),
  ])

  const base = settings.timezone
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: base, dateStyle: 'medium', timeStyle: 'short' }).format(d) : '-')
  const lines: string[] = []
  lines.push(`Job finder digest, ${fmt(new Date())}`)
  lines.push('')
  if (lastRun) lines.push(`Last run: ${lastRun.status} at ${fmt(lastRun.startedAt)}, ${lastRun.totalNew} new jobs, ${lastRun.totalRanked} ranked, ${lastRun.totalDrafted} drafted.`)
  lines.push('')
  lines.push(`New high-score jobs (${newTop.length}):`)
  for (const j of newTop) lines.push(`  ${j.score?.finalScore ?? '-'}  ${j.title} at ${j.companyName} [${j.countryCode ?? '??'}]  ${j.url}`)
  if (!newTop.length) lines.push('  none')
  lines.push('')
  lines.push(`Drafts waiting for you (${awaiting.length}):`)
  for (const a of awaiting) lines.push(`  ${a.status}  ${a.job.title} at ${a.job.companyName}  ${settingsUrl(`/applications/${a.id}`)}`)
  if (!awaiting.length) lines.push('  none')
  lines.push('')
  lines.push(`Replies in the last 24h (${replies.length}):`)
  for (const r of replies) lines.push(`  ${r.classification ?? 'OTHER'}  ${r.application.job.title} at ${r.application.job.companyName}: ${(r.classificationMeta as { summary?: string } | null)?.summary ?? r.subject}`)
  if (!replies.length) lines.push('  none')
  lines.push('')
  lines.push(`Queued to send (${queued.length}):`)
  for (const q of queued) lines.push(`  ${fmt(q.scheduledFor)}  ${q.job.title} at ${q.job.companyName}`)
  if (!queued.length) lines.push('  none')
  lines.push('')
  lines.push(`AI quota today: ${usage.totalCalls} calls, ${usage.totalErrors} errors, ${usage.remainingDaily} requests left across ${usage.keys.filter((k) => k.enabled).length} keys.`)
  lines.push('')
  lines.push(`Dashboard: ${settingsUrl('/dashboard')}`)

  const text = lines.join('\n')
  try {
    await deliver({ to, subject: `Job finder: ${newTop.length} new, ${awaiting.length} to review, ${replies.length} replies`, text })
    await notify('digest', 'Daily digest sent', `To ${to}`)
    return true
  } catch (err) {
    log(`digest failed: ${err instanceof Error ? err.message : err}`)
    await notify('error', 'Daily digest failed', err instanceof Error ? err.message : String(err))
    return false
  }
}

function settingsUrl(path: string): string {
  return `${(process.env.APP_URL ?? 'http://localhost:3011').replace(/\/$/, '')}${path}`
}
