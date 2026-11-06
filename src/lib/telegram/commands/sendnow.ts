import { db } from '@/lib/db'
import { enqueueMailDispatch } from '@/lib/queue'
import { nextSendSlot } from '@/lib/pipeline/send-window'
import { getSettings } from '@/lib/settings/service'
import { defineCommand, type Preview } from '../registry'

/**
 * Releases emails that are ALREADY queued (approved by you or a batch) from their spaced-out times. The
 * dispatcher still decides: send window, daily cap, minimum gap, block list and company cooldown. Nothing new
 * is queued and no address is ever guessed here.
 */
async function releasable(now: Date) {
  const settings = await getSettings()
  const queued = await db.application.findMany({
    where: { status: 'QUEUED', channel: 'email', sentAt: null },
    select: { id: true, scheduledFor: true, job: { select: { countryCode: true } } },
    orderBy: { scheduledFor: 'asc' },
  })
  const cfg = settings.email
  // With notBefore = now - maxGap the slot is "now" when the recipient's window is open, and the next window start when it is not.
  const probe = new Date(now.getTime() - Math.max(cfg.maxGapMinutes, cfg.minGapMinutes) * 60_000)
  const due = queued.filter((q) => !q.scheduledFor || q.scheduledFor <= now)
  const later = queued.filter((q) => q.scheduledFor && q.scheduledFor > now)
  const open = later.filter((q) => nextSendSlot(cfg, q.job.countryCode, probe).getTime() <= now.getTime() + 1000)
  const since = new Date(now)
  since.setUTCHours(0, 0, 0, 0)
  const sentToday = await db.application.count({ where: { sentAt: { gte: since } } })
  return { total: queued.length, due: due.length, open, waitingForWindow: later.length - open.length, capRoom: Math.max(0, cfg.dailySendCap - sentToday), cfg }
}

export const sendnow = defineCommand({
  name: 'sendnow',
  description: 'Send the already-queued emails now instead of at their spaced times',
  usage: '/sendnow',
  group: 'Mail',
  risk: 'outward',
  async preview({ now }): Promise<Preview> {
    const r = await releasable(now)
    if (r.total === 0) return { text: 'No emails are queued, so there is nothing to send.', proceed: false }
    if (r.open.length === 0) return { text: `${r.total} emails are queued: ${r.due} already due, ${r.waitingForWindow} waiting for their send window. None can be moved earlier.`, proceed: false }
    const lines = [
      `**${r.open.length} queued emails would go out now** (of ${r.total} queued).`,
      `${r.due} are already due, ${r.waitingForWindow} wait for their send window.`,
      `Daily cap room today: ${r.capRoom} of ${r.cfg.dailySendCap}. Minimum gap ${r.cfg.minGapMinutes} min between emails still applies, as do the block list and the company cooldown.`,
    ]
    if (!r.cfg.sendingEnabled) lines.push('Sending is switched off in Settings: only emails of a running batch go out.')
    return { text: lines.join('\n'), proceed: true }
  },
  async handler({ now }) {
    const r = await releasable(now)
    let moved = 0
    for (const [i, q] of r.open.entries()) {
      const res = await db.application.updateMany({ where: { id: q.id, status: 'QUEUED', sentAt: null }, data: { scheduledFor: new Date(now.getTime() + i) } })
      moved += res.count
    }
    if (moved) await enqueueMailDispatch().catch(() => null)
    return `Released ${moved} queued email${moved === 1 ? '' : 's'}. The dispatcher sends them one by one (gap ${r.cfg.minGapMinutes} min, cap room ${r.capRoom}); /status shows the queue.`
  },
})
