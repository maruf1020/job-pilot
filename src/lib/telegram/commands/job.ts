import { db } from '@/lib/db'
import { appLink, truncate } from '../format'
import { defineCommand } from '../registry'

export const job = defineCommand({
  name: 'job',
  description: 'Find a job by company or title and show its status',
  usage: '/job <text>',
  group: 'Overview',
  risk: 'read',
  args: [{ name: 'text', required: true, rest: true }],
  async handler({ rest }) {
    const q = rest.trim().slice(0, 80)
    const jobs = await db.job.findMany({
      where: { OR: [{ companyName: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] },
      orderBy: [{ finalScore: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
      take: 6,
      select: { id: true, title: true, companyName: true, countryCode: true, status: true, finalScore: true, application: { select: { id: true, status: true, channel: true, portalStatus: true, sentAt: true } } },
    })
    if (!jobs.length) return `No job matches "${truncate(q, 40)}".`
    const lines = [`**${jobs.length === 6 ? 'First 6' : jobs.length} match${jobs.length === 1 ? '' : 'es'} for "${truncate(q, 40)}"**`]
    for (const j of jobs) {
      const a = j.application
      const app = a ? `${a.status.toLowerCase()} via ${a.channel}${a.portalStatus ? `/${a.portalStatus.toLowerCase()}` : ''}${a.sentAt ? `, sent ${a.sentAt.toISOString().slice(0, 10)}` : ''}` : 'not applied'
      lines.push(`${j.finalScore ?? '-'} | ${truncate(`${j.companyName}: ${j.title}`, 90)}${j.countryCode ? ` (${j.countryCode})` : ''}`, `   job ${j.status.toLowerCase()}, ${app}`, `   ${appLink(a ? `/applications/${a.id}` : `/jobs/${j.id}`)}`)
    }
    return lines.join('\n')
  },
})
