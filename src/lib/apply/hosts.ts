import { db } from '@/lib/db'

/**
 * Host triage (plan-apply-all.md 7.2): what each website taught the agent. Every finished attempt
 * updates its host's row; batches order candidates by the host's success rate and skip a host whose
 * forms failed several times in a row for the same reason, until a week has passed or you clear it.
 */

export const HOST_KINDS = ['direct-form', 'ats-embed', 'needs-account', 'sign-in-wall', 'talent-community', 'external-redirect', 'bot-wall', 'captcha', 'no-form', 'closed', 'unknown'] as const
export type HostKind = (typeof HOST_KINDS)[number]

export type HostOutcome = 'SUBMITTED' | 'AWAITING_REVIEW' | 'NEEDS_HUMAN' | 'FAILED' | 'CANCELLED'

/** Reasons that say nothing about the website (your Chrome, the worker, the network, you pausing). */
const NOT_THE_SITE_RE = /your chrome|worker restarted|paused|held because|err_name_not_resolved|err_internet_disconnected|err_network|connectovercdp|browser has been closed|quota|batch stopped|stuck for over/i

/** What kind of host a stop reason points to, or null when it says nothing about the host. */
export function kindFromReason(reason: string | null | undefined): HostKind | null {
  const r = (reason ?? '').toLowerCase()
  if (!r) return null
  if (/captcha|verify you are human|turnstile|hcaptcha|recaptcha/.test(r)) return 'captcha'
  if (/creates an account|create an account|choose password|retype password|password/.test(r)) return 'needs-account'
  if (/sign in|log in|sign-in|login|magic link|sign-in link/.test(r)) return 'sign-in-wall'
  if (/talent.?community|job.?alert/.test(r)) return 'talent-community'
  if (/403|forbidden|access denied|bot detection|blocked/.test(r)) return 'bot-wall'
  if (/closed|removed|no longer|expired|not found|404/.test(r)) return 'closed'
  if (/external website|another site|redirect/.test(r)) return 'external-redirect'
  if (/could not find|without reaching the form|no form|no apply/.test(r)) return 'no-form'
  return null
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '').trim()
}

/** Record one finished attempt on its host. Never throws (triage must not break an attempt). */
export async function recordHostOutcome(host: string | null | undefined, outcome: HostOutcome, reason?: string | null, opts: { atsType?: string | null; skipAfterFails?: number } = {}): Promise<void> {
  if (!host) return
  const h = normalizeHost(host)
  if (!h) return
  const r = reason ?? null
  // Your Chrome, the worker or the network failing teaches nothing about the website.
  if (outcome !== 'SUBMITTED' && r && NOT_THE_SITE_RE.test(r)) return
  try {
    const prev = await db.hostProfile.findUnique({ where: { host: h } })
    const kind = outcome === 'SUBMITTED' ? 'direct-form' : (kindFromReason(r) ?? prev?.kind ?? 'unknown')
    const sameReason = !!prev?.lastReason && !!r && prev.lastReason.slice(0, 60).toLowerCase() === r.slice(0, 60).toLowerCase()
    const failed = outcome === 'FAILED' || outcome === 'NEEDS_HUMAN' || outcome === 'CANCELLED'
    const streak = outcome === 'SUBMITTED' ? 0 : failed ? (sameReason || !prev?.lastReason ? (prev?.failStreak ?? 0) + 1 : 1) : (prev?.failStreak ?? 0)
    const limit = opts.skipAfterFails ?? 3
    // A host that fails the same way `limit` times in a row rests for a week (CAPTCHA hosts go to your queue instead).
    const skipUntil = outcome === 'SUBMITTED' ? null : streak >= limit && kind !== 'captcha' ? new Date(Date.now() + 7 * 86_400_000) : (prev?.skipUntil ?? null)
    const data = {
      kind,
      atsType: opts.atsType ?? prev?.atsType ?? null,
      lastOutcome: outcome,
      lastReason: r?.slice(0, 500) ?? prev?.lastReason ?? null,
      failStreak: streak,
      skipUntil,
    }
    await db.hostProfile.upsert({
      where: { host: h },
      create: { host: h, ...data, attempts: 1, submitted: outcome === 'SUBMITTED' ? 1 : 0, needsHuman: outcome === 'NEEDS_HUMAN' ? 1 : 0, failed: outcome === 'FAILED' ? 1 : 0 },
      update: {
        ...data,
        attempts: { increment: 1 },
        ...(outcome === 'SUBMITTED' ? { submitted: { increment: 1 } } : {}),
        ...(outcome === 'NEEDS_HUMAN' ? { needsHuman: { increment: 1 } } : {}),
        ...(outcome === 'FAILED' ? { failed: { increment: 1 } } : {}),
      },
    })
  } catch {
    // Triage is advisory; the attempt itself already finished.
  }
}

export interface HostStat {
  kind: string
  attempts: number
  submitted: number
  skipUntil: Date | null
  loggedIn: boolean
}

/** All host rows in one read, for ordering and skipping candidates. */
export async function loadHostStats(): Promise<Map<string, HostStat>> {
  const rows = await db.hostProfile.findMany({ select: { host: true, kind: true, attempts: true, submitted: true, skipUntil: true, loggedIn: true } })
  return new Map(rows.map((r) => [r.host, r]))
}

/** Why a batch should not take this host now, or null. */
export function hostSkipReason(host: string, stats: Map<string, HostStat>, now = new Date()): string | null {
  const s = stats.get(normalizeHost(host))
  if (!s) return null
  if (s.skipUntil && s.skipUntil > now) return `${host} failed the same way several times; skipped until ${s.skipUntil.toISOString().slice(0, 10)}`
  if ((s.kind === 'needs-account' || s.kind === 'sign-in-wall') && !s.loggedIn && s.submitted === 0 && s.attempts >= 2) return `${host} needs an account or a sign-in first`
  if ((s.kind === 'no-form' || s.kind === 'talent-community' || s.kind === 'closed') && s.submitted === 0 && s.attempts >= 2) return `${host} has no application form the agent can use`
  return null
}

/**
 * Expected success on a host, 0..1, with a prior so a new host sits in the middle: hosts that
 * submit go first, hosts that never do go last.
 */
export function hostSuccess(host: string, stats: Map<string, HostStat>): number {
  const s = stats.get(normalizeHost(host))
  const prior = 0.5
  if (!s) return prior
  return (s.submitted + prior * 2) / (s.attempts + 2)
}

export { normalizeHost }
