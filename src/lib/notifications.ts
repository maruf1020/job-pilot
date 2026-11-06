import { db } from '@/lib/db'
import type { NotificationType, ReplyClassification } from '@/lib/domain'
import { nextStepFor } from '@/lib/next-step'
import { markPushed, pushChannel, pushStyle, sendPush, shouldPush } from '@/lib/push'
import { getSettings } from '@/lib/settings/service'

/**
 * In-app notification, and a phone push when a channel is set up and Settings → General
 * lets this type through. `push: false` keeps it in the app (auto-replies, bounces).
 * `classification` (replies) is stored and decides whether it is a next step (pinned + popup).
 */
export async function notify(type: NotificationType, title: string, body?: string, link?: string, opts: { push?: boolean; classification?: ReplyClassification } = {}) {
  const classification = opts.classification ?? null
  const row = await db.notification.create({ data: { type, title, body, link, classification, nextStep: nextStepFor(type, classification) } }).catch((err) => {
    console.error('[notify] failed', err)
    return null
  })
  if (opts.push !== false && (await pushChannel())) {
    try {
      const settings = await getSettings()
      if (shouldPush(type, settings)) {
        markPushed(type)
        void sendPush({ title, body, link, ...pushStyle(type) }).then((r) => {
          if (!r.ok) console.warn(`[notify] phone push failed: ${r.error}`)
        })
      }
    } catch (err) {
      console.warn('[notify] phone push skipped', err)
    }
  }
  return row
}

/** The application was sent: its "needs you" notifications are done, so they stop counting as unread. */
export async function resolveNeedsYou(applicationId: string): Promise<void> {
  await db.notification
    .updateMany({ where: { readAt: null, type: 'review_needed', link: `/applications/${applicationId}` }, data: { readAt: new Date() } })
    .catch(() => undefined)
}
