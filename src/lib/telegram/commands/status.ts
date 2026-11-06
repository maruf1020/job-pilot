import { getAiUsageSummary } from '@/lib/ai/usage'
import { db } from '@/lib/db'
import { getSettings } from '@/lib/settings/service'
import { countApplications } from '../analytics'
import { ago, appLink } from '../format'
import { isPausedFromTelegram } from '../pause-mark'
import { getTimezone, tzLabel } from '../tz'
import { defineCommand } from '../registry'

export const status = defineCommand({
  name: 'status',
  description: 'Workers, batches, queue, sent today, bounces, Gemini, last search',
  usage: '/status',
  group: 'Overview',
  risk: 'read',
  async handler({ now }) {
    const since = new Date(now.getTime() - 86_400_000)
    const tz = await getTimezone()
    const [workers, portal, email, queued, sentEmail, sentBrowser, bounces, run, settings, ai] = await Promise.all([
      db.workerStatus.findMany({ orderBy: { id: 'asc' } }),
      db.portalBatch.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'asc' } }),
      db.applyBatch.findFirst({ where: { status: 'RUNNING' } }),
      db.application.count({ where: { status: 'QUEUED', sentAt: null } }),
      countApplications(db, { period: 'today', channel: 'email', status: 'sent' }, now, tz),
      countApplications(db, { period: 'today', channel: 'browser', status: 'sent' }, now, tz),
      db.emailMessage.count({ where: { direction: 'INBOUND', classification: 'BOUNCE', createdAt: { gte: since } } }),
      db.searchRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      getSettings(),
      getAiUsageSummary().catch(() => null),
    ])
    const lines = ['**Status**']
    lines.push(`Workers: ${workers.length ? workers.map((w) => `${w.id === 2 ? 'apply' : 'search'} ${w.state} (${ago(w.heartbeatAt, now)})`).join(', ') : 'no heartbeat yet'}`)
    lines.push(
      portal
        ? `Browser batch: ${portal.submitted}/${portal.continuous ? 'no end' : portal.target} submitted, ${portal.needsHuman} need you${isPausedFromTelegram(portal.waitingFor) ? ', PAUSED' : portal.waitingFor ? ` (${portal.waitingFor.slice(0, 60)})` : ''}`
        : 'Browser batch: none running',
    )
    lines.push(
      email
        ? `Email batch: ${email.sent} sent, ${email.queued} queued of ${email.continuous ? 'no end' : email.target}${isPausedFromTelegram(email.waitingFor) ? ', PAUSED' : email.waitingFor ? ` (${email.waitingFor.slice(0, 60)})` : ''}`
        : 'Email batch: none running',
    )
    lines.push(`Queued emails: ${queued}${settings.email.sendingEnabled ? '' : ' (sending is switched off in Settings)'}`)
    lines.push(`Sent today (${tzLabel(tz)}): ${sentEmail} by email, ${sentBrowser} by browser (cap ${settings.email.dailySendCap}/day for email)`)
    lines.push(`Bounces, last 24 h: ${bounces}`)
    lines.push(ai ? `Gemini: ${ai.totalCalls} calls today, ${ai.totalErrors} errors, ${ai.liteRemaining} lite left` : 'Gemini: usage unavailable')
    lines.push(run ? `Last search: ${run.status.toLowerCase()} ${ago(run.startedAt, now)}, ${run.totalNew} new jobs` : 'Last search: none yet')
    lines.push('', appLink('/dashboard'))
    return lines.join('\n')
  },
})
