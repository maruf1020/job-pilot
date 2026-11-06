import { env } from '@/lib/env'
import { getServiceCredential } from '@/lib/keys/service-keys'
import type { NotificationType } from '@/lib/domain'

/**
 * Phone notifications through ntfy or a Telegram bot (configured in .env). Only for things
 * that need you within hours: interview requests, replies, a form waiting, a problem.
 */

export type PushChannel = 'ntfy' | 'telegram'

export async function pushChannel(): Promise<PushChannel | null> {
  if (await getServiceCredential('ntfy')) return 'ntfy'
  if (await getServiceCredential('telegram')) return 'telegram'
  return null
}

export interface PushMessage {
  title: string
  body?: string | null
  /** App path ("/applications/x") or absolute URL to open from the notification. */
  link?: string | null
  priority?: 'high' | 'default' | 'low'
  tags?: string[]
}

const NTFY_PRIORITY = { high: 4, default: 3, low: 2 } as const

function absolute(link: string | null | undefined): string | undefined {
  if (!link) return undefined
  return /^https?:\/\//.test(link) ? link : `${env.APP_URL.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}`
}

export async function sendPush(msg: PushMessage): Promise<{ ok: boolean; channel: PushChannel | null; error?: string }> {
  const channel = await pushChannel()
  const ntfy = await getServiceCredential('ntfy')
  const tg = await getServiceCredential('telegram')
  if (!channel) return { ok: false, channel: null, error: 'No phone channel configured (ntfy or a Telegram bot + chat id in Settings, or in .env)' }
  const click = absolute(msg.link)
  try {
    const res =
      channel === 'ntfy'
        ? await fetch((ntfy?.NTFY_SERVER ?? env.NTFY_SERVER).replace(/\/$/, ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(ntfy?.NTFY_TOKEN ? { Authorization: `Bearer ${ntfy.NTFY_TOKEN}` } : {}) },
            // JSON publishing keeps non-ASCII titles intact (headers would not).
            body: JSON.stringify({ topic: ntfy?.NTFY_TOPIC, title: msg.title.slice(0, 250), message: (msg.body || msg.title).slice(0, 3500), priority: NTFY_PRIORITY[msg.priority ?? 'default'], tags: msg.tags, click }),
            signal: AbortSignal.timeout(8000),
          })
        : await fetch(`https://api.telegram.org/bot${tg?.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tg?.TELEGRAM_CHAT_ID, text: [msg.title, msg.body, click].filter(Boolean).join('\n\n').slice(0, 4000), disable_web_page_preview: true }),
            signal: AbortSignal.timeout(8000),
          })
    if (!res.ok) return { ok: false, channel, error: `${channel} answered ${res.status}` }
    return { ok: true, channel }
  } catch (err) {
    return { ok: false, channel, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Types that can come in bursts (a batch of forms, repeated errors): one push per window. */
const BURSTY: ReadonlySet<NotificationType> = new Set(['review_needed', 'error', 'run_complete', 'sent', 'quota'])
export const BURST_WINDOW_MS = 15 * 60_000
const lastPush = new Map<NotificationType, number>()

const PRIORITY_FOR: Partial<Record<NotificationType, PushMessage['priority']>> = { interview: 'high', reply: 'high', error: 'default', review_needed: 'default' }
const TAGS_FOR: Partial<Record<NotificationType, string[]>> = { interview: ['tada'], reply: ['envelope'], review_needed: ['memo'], error: ['warning'] }

/** Whether a notification of this type goes to the phone now (settings, burst window). */
export function shouldPush(type: NotificationType, settings: { pushEnabled: boolean; pushTypes: readonly string[] }, now = Date.now()): boolean {
  if (!settings.pushEnabled || !settings.pushTypes.includes(type)) return false
  if (!BURSTY.has(type)) return true
  const last = lastPush.get(type)
  return last === undefined || now - last >= BURST_WINDOW_MS
}

export function markPushed(type: NotificationType, now = Date.now()) {
  lastPush.set(type, now)
}

export function pushStyle(type: NotificationType): Pick<PushMessage, 'priority' | 'tags'> {
  return { priority: PRIORITY_FOR[type] ?? 'low', tags: TAGS_FOR[type] }
}
