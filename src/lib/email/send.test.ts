import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The dispatcher runs against fakes only: an in-memory queue, a fake clock and a fake Gmail.
// Nothing is sent anywhere; recipients are on reserved-looking test companies.
const h = vi.hoisted(() => {
  type Row = { id: string; status: string; scheduledFor: Date; sentAt: Date | null }
  const state = { rows: [] as Row[], sentTimes: [] as Array<{ id: string; at: number }>, lastSentAt: null as Date | null, onSent: null as ((id: string) => void) | null }
  const db = {
    application: {
      findMany: vi.fn(async (args: { where: { scheduledFor: { lte: Date } } }) =>
        state.rows.filter((r) => r.status === 'QUEUED' && r.scheduledFor <= args.where.scheduledFor.lte).sort((a, b) => +a.scheduledFor - +b.scheduledFor).map((r) => ({ id: r.id, scheduledFor: r.scheduledFor })),
      ),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async (args: { where: { id?: string; scheduledFor?: { lte: Date } } }) => {
        if (!args.where.id) return state.lastSentAt ? { sentAt: state.lastSentAt } : null
        const r = state.rows.find((x) => x.id === args.where.id && x.status === 'QUEUED' && !x.sentAt && x.scheduledFor <= args.where.scheduledFor!.lte)
        return r ? { id: r.id } : null
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const r = state.rows.find((x) => x.id === args.where.id)!
        return { ...r, toEmail: `careers@${r.id}.ie`, cooldownOverride: false, job: { id: `job-${r.id}`, title: 'Engineer', companyName: r.id, countryCode: 'IE', companyId: `co-${r.id}` }, drafts: [{ id: `d-${r.id}`, subject: 'Application', body: 'Hello' }] }
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { status?: string; sentAt?: Date } }) => {
        const r = state.rows.find((x) => x.id === args.where.id)
        if (r && args.data.status) r.status = args.data.status
        if (r && args.data.sentAt) r.sentAt = args.data.sentAt
        return {}
      }),
    },
    candidateProfile: { findUnique: vi.fn(async () => ({ fullName: 'Test Person' })) },
    oAuthToken: { findUnique: vi.fn(async () => ({ accountEmail: 'sender@test.invalid' })), deleteMany: vi.fn(async () => ({ count: 1 })) },
    emailMessage: { create: vi.fn(async () => ({})) },
    emailDraft: { updateMany: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    job: { update: vi.fn(async () => ({})) },
    notification: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  }
  return { state, db }
})

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => null) }))
vi.mock('@/lib/settings/service', () => ({
  getSettings: vi.fn(async () => ({ email: { provider: 'gmail', sendingEnabled: false, dailySendCap: 200, minGapMinutes: 0.1, maxGapMinutes: 0.15, attachResume: false, ccSelf: false, followUp: { enabled: false, afterDays: 7 } } })),
}))
vi.mock('@/lib/pipeline/cooldown', () => ({ findCooldownConflict: vi.fn(async () => null), describeConflict: vi.fn() }))
vi.mock('@/lib/pipeline/decide', () => ({ mailProviderReady: vi.fn(async () => ({ ready: true })) }))
vi.mock('./smtp', () => ({ smtpSend: vi.fn() }))
vi.mock('./suppression', () => ({
  suppressedReason: vi.fn(async () => null),
  suppressAddress: vi.fn(async () => undefined),
  withoutSuppressed: vi.fn(async (emails: string[]) => emails),
  recentBounceRate: vi.fn(async () => ({ sent: 0, bounced: 0, rate: 0 })),
}))
vi.mock('./gmail', () => ({
  gmailTestConnection: vi.fn(),
  gmailSend: vi.fn(async () => {
    const id = h.state.rows.find((r) => r.status === 'QUEUED' && !r.sentAt && !h.state.sentTimes.some((s) => s.id === r.id))?.id ?? '?'
    return { id: `msg-${id}`, threadId: `thread-${id}` }
  }),
}))

import { notify } from '@/lib/notifications'
import { gmailSend } from './gmail'
import { dispatchDueSends, isMailRateLimitError } from './send'

const T0 = new Date('2026-10-23T03:00:00Z').getTime()
const sleep = async (ms: number) => void vi.setSystemTime(Date.now() + ms)

describe('dispatchDueSends pacing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ now: T0, toFake: ['Date'] })
    h.state.sentTimes = []
    h.state.onSent = null
    h.state.lastSentAt = new Date('2026-10-07T23:04:13Z')
    h.db.application.update.mockImplementation(async (args: { where: { id: string }; data: { status?: string; sentAt?: Date } }) => {
      const r = h.state.rows.find((x) => x.id === args.where.id)
      if (r && args.data.sentAt) h.state.sentTimes.push({ id: r.id, at: Date.now() })
      if (r && args.data.status) r.status = args.data.status
      if (r && args.data.sentAt) r.sentAt = args.data.sentAt
      if (r && args.data.sentAt) h.state.onSent?.(r.id)
      return {}
    })
  })
  afterEach(() => vi.useRealTimers())

  it('paces an overdue backlog by the minimum gap instead of sending it in one burst', async () => {
    h.state.rows = ['elastic', 'aircall', 'wolt'].map((id, i) => ({ id, status: 'QUEUED', scheduledFor: new Date(T0 - (10 - i) * 60_000), sentAt: null }))
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(3)
    expect(h.state.sentTimes.map((s) => (s.at - T0) / 1000)).toEqual([0, 6, 12])
  })

  it('sends each email at its own second within the run and leaves later ones to the next run', async () => {
    h.state.rows = [
      { id: 'a', status: 'QUEUED', scheduledFor: new Date(T0 + 4_000), sentAt: null },
      { id: 'b', status: 'QUEUED', scheduledFor: new Date(T0 + 13_000), sentAt: null },
      { id: 'c', status: 'QUEUED', scheduledFor: new Date(T0 + 90_000), sentAt: null },
    ]
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(2)
    expect(h.state.sentTimes.map((s) => [s.id, (s.at - T0) / 1000])).toEqual([
      ['a', 4],
      ['b', 13],
    ])
    expect(h.state.rows.find((r) => r.id === 'c')?.status).toBe('QUEUED')
  })

  it('skips an application that was stopped while waiting for its time, without marking it failed', async () => {
    h.state.rows = [
      { id: 'a', status: 'QUEUED', scheduledFor: new Date(T0), sentAt: null },
      { id: 'b', status: 'QUEUED', scheduledFor: new Date(T0 + 10_000), sentAt: null },
    ]
    const stopDuringWait = async (ms: number) => {
      h.state.rows[1].status = 'REVIEW' // you pressed Stop: it went back to Review
      await sleep(ms)
    }
    expect(await dispatchDueSends(() => undefined, { sleep: stopDuringWait })).toBe(1)
    expect(h.state.rows[1].status).toBe('REVIEW')
  })

  it('keeps the gap after the last email of the previous run', async () => {
    h.state.lastSentAt = new Date(T0 - 2_000)
    h.state.rows = [{ id: 'a', status: 'QUEUED', scheduledFor: new Date(T0 - 60_000), sentAt: null }]
    await dispatchDueSends(() => undefined, { sleep })
    expect(h.state.sentTimes.map((s) => (s.at - T0) / 1000)).toEqual([4])
  })

  it('keeps one run going while emails keep coming due, up to the run limit', async () => {
    // A batch queued 20 emails 6 s apart: one run sends them all, each at its own second.
    h.state.rows = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, status: 'QUEUED', scheduledFor: new Date(T0 + i * 6_000), sentAt: null }))
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(20)
    expect(h.state.sentTimes.map((s) => (s.at - T0) / 1000)).toEqual(Array.from({ length: 20 }, (_, i) => i * 6))
    // With a 60 s limit the run stops in time and leaves the rest queued for the next one.
    h.state.rows = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, status: 'QUEUED', scheduledFor: new Date(Date.now() + i * 6_000), sentAt: null }))
    h.state.lastSentAt = null
    expect(await dispatchDueSends(() => undefined, { sleep, maxRunMs: 60_000 })).toBe(11)
  })

  it('also sends what gets queued while the run is going (a batch right after a reconnect)', async () => {
    h.state.rows = [{ id: 'a', status: 'QUEUED', scheduledFor: new Date(T0 - 60_000), sentAt: null }]
    h.state.onSent = (id) => {
      if (id === 'a') h.state.rows.push({ id: 'b', status: 'QUEUED', scheduledFor: new Date(T0 + 8_000), sentAt: null })
    }
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(2)
    expect(h.state.sentTimes.map((s) => [s.id, (s.at - T0) / 1000])).toEqual([
      ['a', 0],
      ['b', 8],
    ])
  })

  // Last in this file: the pause it triggers lasts for the rest of the module's life.
  it('keeps everything queued and pauses when Gmail limits sending, instead of failing each application', async () => {
    h.state.rows = ['a', 'b', 'c'].map((id, i) => ({ id, status: 'QUEUED', scheduledFor: new Date(T0 - (5 - i) * 60_000), sentAt: null }))
    vi.mocked(gmailSend).mockRejectedValueOnce(new Error('User-rate limit exceeded.  Retry after 2026-10-23T03:15:00Z'))
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(0)
    expect(h.state.rows.map((r) => r.status)).toEqual(['QUEUED', 'QUEUED', 'QUEUED'])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notify).mock.calls[0]?.[1]).toBe('Sending paused: mail provider limit')
    // The next runs within the pause do not even try.
    expect(await dispatchDueSends(() => undefined, { sleep })).toBe(0)
    expect(gmailSend).toHaveBeenCalledTimes(1)
  })
})

describe('mail provider limits', () => {
  it('tells sending limits from other send failures', () => {
    for (const m of ['User-rate limit exceeded', 'Rate Limit Exceeded', 'Daily user sending quota exceeded.', 'dailyLimitExceeded', '421 4.7.0 Try again later, closing connection', '550 5.4.5 Daily user sending quota exceeded']) expect(isMailRateLimitError(m), m).toBe(true)
    for (const m of ['Message size limit exceeded', 'Recipient address rejected', 'invalid_grant', 'socket hang up']) expect(isMailRateLimitError(m), m).toBe(false)
  })
})

describe('pause length after a throttling error', () => {
  it('waits briefly for the per-minute API quota and long for daily sending limits', async () => {
    const { rateLimitPauseMs } = await import('./send')
    expect(rateLimitPauseMs("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'")).toBe(90_000)
    expect(rateLimitPauseMs('Daily user sending quota exceeded')).toBe(60 * 60_000)
    expect(rateLimitPauseMs('421 4.7.0 Try again later')).toBe(15 * 60_000)
  })
})
