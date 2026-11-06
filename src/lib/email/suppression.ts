import { db } from '@/lib/db'

/**
 * Global block list for recipients. A bounced address is blocked for every job and every
 * company from then on; the per-company rules in address.ts stay as they are.
 */

export async function suppressAddress(email: string, reason: string, opts: { source?: 'bounce' | 'manual'; applicationId?: string | null } = {}): Promise<void> {
  const e = email.trim().toLowerCase()
  if (!e.includes('@')) return
  await db.suppressedAddress
    .upsert({
      where: { email: e },
      update: { reason: reason.slice(0, 300) },
      create: { email: e, reason: reason.slice(0, 300), source: opts.source ?? 'bounce', applicationId: opts.applicationId ?? null },
    })
    .catch(() => undefined)
}

/** Why the address is blocked, or null. */
export async function suppressedReason(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const row = await db.suppressedAddress.findUnique({ where: { email: email.trim().toLowerCase() }, select: { reason: true, createdAt: true } })
  return row ? `"${email}" is on the block list since ${row.createdAt.toISOString().slice(0, 10)} (${row.reason})` : null
}

/** Drop blocked addresses from a candidate list. */
export async function withoutSuppressed(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return emails
  const rows = await db.suppressedAddress.findMany({ where: { email: { in: emails.map((e) => e.toLowerCase()) } }, select: { email: true } })
  const blocked = new Set(rows.map((r) => r.email))
  return emails.filter((e) => !blocked.has(e.toLowerCase()))
}

/**
 * Bounce share of the last 7 days (bounce messages / applications sent). Automatic sending
 * pauses above the brake; your own "Send now" is not affected.
 */
export async function recentBounceRate(days = 7): Promise<{ sent: number; bounced: number; rate: number }> {
  const since = new Date(Date.now() - days * 86_400_000)
  const [sent, bounced] = await Promise.all([
    db.application.count({ where: { sentAt: { gte: since } } }),
    db.emailMessage.count({ where: { direction: 'INBOUND', classification: 'BOUNCE', receivedAt: { gte: since } } }),
  ])
  return { sent, bounced, rate: sent ? bounced / sent : 0 }
}
