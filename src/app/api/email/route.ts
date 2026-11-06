import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { db } from '@/lib/db'
import { disconnectGmail, gmailConnection, gmailRedirectUri, gmailTestConnection } from '@/lib/email/gmail'
import { deliver } from '@/lib/email/send'
import { isGmailConfigured } from '@/lib/env'
import { smtpConfig } from '@/lib/keys/service-keys'
import { mailProviderReady, sentOrQueuedToday } from '@/lib/pipeline/decide'
import { getSettings } from '@/lib/settings/service'

/** GET /api/email → provider status for Settings → Email. */
export const GET = route(async () => {
  const settings = await getSettings()
  const [gmail, ready, today, smtp] = await Promise.all([gmailConnection(), mailProviderReady(), sentOrQueuedToday(), smtpConfig()])
  return ok({
    provider: settings.email.provider,
    ready,
    gmail: { configured: isGmailConfigured, redirectUri: gmailRedirectUri(), connection: gmail },
    smtp: { configured: Boolean(smtp), host: smtp?.host ?? null, from: smtp?.from ?? null },
    sentOrQueuedToday: today,
    dailySendCap: settings.email.dailySendCap,
  })
})

const schema = z.object({ action: z.enum(['test', 'disconnect-gmail', 'test-gmail']) })

export const POST = route(async (req) => {
  const { action } = await readJson(req, schema)
  if (action === 'disconnect-gmail') {
    await disconnectGmail()
    return ok({ disconnected: true })
  }
  if (action === 'test-gmail') return ok(await gmailTestConnection())
  const user = await db.user.findFirst({ select: { email: true } })
  const settings = await getSettings()
  const to = settings.digestEmail ?? user?.email
  if (!to) throw new Error('No address to send the test to')
  const r = await deliver({ to, subject: 'Job finder test email', text: `This is a test from your job finder.\n\nIf you can read this, sending works.\n\n${new Date().toISOString()}` })
  return ok(r, { message: `Test email sent to ${to}` })
})
