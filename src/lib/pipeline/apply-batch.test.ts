import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything the tick touches is faked in memory: no database, no AI, no mail. Nothing real is
// drafted or queued. Jobs become "ready" once drafted and leave the pool once queued, as in the app.
const h = vi.hoisted(() => {
  type App = { id: string; status: 'REVIEW' | 'QUEUED'; batchId: string | null }
  type Job = { id: string; title: string; companyName: string; companyId: string; countryCode: string | null; finalScore: number; contactEmail: string; description: string; remote: boolean; visaFlag: null; contactEmailSource: string | null; company: { domain: string | null } }
  const state = {
    emailReady: false,
    target: 100,
    queuedBefore: 6,
    jobs: [] as Job[],
    apps: new Map<string, App>(),
    waitingFor: [] as Array<string | null>,
    batchIdWrites: [] as string[],
    counters: { drafted: 0, held: 0 },
    suppressed: [] as string[],
  }
  const BATCH = 'batch-qp2hm9'
  const queuedInBatch = () => state.queuedBefore + [...state.apps.values()].filter((a) => a.status === 'QUEUED' && a.batchId === BATCH).length
  const db = {
    applyBatch: {
      findFirst: vi.fn(async () => ({ id: BATCH, status: 'RUNNING', target: state.target, continuous: false, minScore: 72, includeGuessed: false, countries: [] as string[], queued: queuedInBatch() })),
      findUnique: vi.fn(async () => ({ cancelRequested: false, status: 'RUNNING' })),
      update: vi.fn(async (args: { data: { waitingFor?: string | null; drafted?: unknown; held?: unknown } }) => {
        if ('waitingFor' in args.data) state.waitingFor.push(args.data.waitingFor ?? null)
        if (args.data.drafted) state.counters.drafted++
        if (args.data.held) state.counters.held++
        return {}
      }),
    },
    application: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => state.apps.get(args.where.id) ?? null),
      groupBy: vi.fn(async () => [{ status: 'QUEUED', _count: { _all: queuedInBatch() } }]),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        if (args.where.status !== 'REVIEW') return [...state.apps.values()].filter((a) => a.batchId === BATCH).map(() => ({ job: { companyId: 'x', countryCode: 'DE' } }))
        return [...state.apps.entries()]
          .filter(([, a]) => a.status === 'REVIEW' && !a.batchId)
          .map(([jobId, a]) => {
            const j = state.jobs.find((x) => x.id === jobId)!
            return { id: a.id, toEmail: j.contactEmail, job: j }
          })
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { batchId?: string | null } }) => {
        const app = [...state.apps.values()].find((a) => a.id === args.where.id)
        if (app && 'batchId' in args.data) app.batchId = args.data.batchId ?? null
        if (args.data.batchId) state.batchIdWrites.push(args.where.id)
        return {}
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    job: { findMany: vi.fn(async () => state.jobs.filter((j) => !state.apps.has(j.id))) },
    suppressedAddress: { findMany: vi.fn(async (args: { where: { email: { in: string[] } } }) => state.suppressed.filter((e) => args.where.email.in.includes(e)).map((email) => ({ email }))) },
  }
  /** What draftApplication does to the data: an application in Review with a passing draft. */
  const writeDraft = (jobId: string) => {
    const app: App = { id: `app-${jobId}`, status: 'REVIEW', batchId: null }
    state.apps.set(jobId, app)
    return { id: app.id, status: 'REVIEW', channel: 'email', drafts: [{ passed: true }] }
  }
  return { state, db, writeDraft }
})

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/candidate/load', async () => {
  const { buildCandidateContext } = await import('@/lib/candidate/context')
  return { loadCandidateContext: vi.fn(async () => buildCandidateContext({ fullName: 'Alex Rivera', citizenships: ['PT'], languages: ['English'] })) }
})
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => null) }))
vi.mock('@/lib/email/send', () => ({ verifyMailbox: vi.fn(async () => ({ ready: true })) }))
vi.mock('@/lib/ai/usage', () => ({ getAiUsageSummary: vi.fn(async () => ({ primaryRemaining: 0, liteRemaining: 1738 })) }))
vi.mock('@/lib/settings/service', () => ({
  getSettings: vi.fn(async () => ({ email: { provider: 'gmail', dailySendCap: 200, companyCooldownScope: 'company_country', companyCooldownDays: 15 }, ai: { concurrency: 4 }, search: {}, portal: { onlySoftwareEngineerTitles: false } })),
}))
vi.mock('./prefilter', () => ({ prefilterReason: () => ({ reason: null }), fitsStack: () => true }))
vi.mock('./cooldown', () => ({ findCooldownConflict: vi.fn(async () => null) }))
vi.mock('./decide', () => ({
  mailProviderReady: vi.fn(async () => (h.state.emailReady ? { ready: true } : { ready: false, reason: 'Gmail not connected (Settings → Email)' })),
  sentOrQueuedToday: vi.fn(async () => h.state.queuedBefore),
  evaluateAutoSend: vi.fn(async (id: string) => {
    const app = [...h.state.apps.values()].find((a) => a.id === id)
    if (app) app.status = 'QUEUED'
    return { outcome: 'queued', scheduledFor: new Date('2026-10-23T08:00:00Z') }
  }),
}))
vi.mock('./draft', () => ({ draftApplication: vi.fn() }))

import { evaluateAutoSend } from './decide'
import { draftApplication } from './draft'
import { emailNotReadyNote, PER_ROUND, pickForTick, tickApplyBatch } from './apply-batch'

const job = (i: number) => ({ id: `job-${i}`, title: `Engineer ${i}`, companyName: `Company ${i}`, companyId: `co-${i}`, countryCode: 'DE', finalScore: 99 - (i % 20), contactEmail: `careers@company${i}.de`, description: '', remote: false, visaFlag: null, contactEmailSource: null, company: { domain: `company${i}.de` } })
const tick = () => tickApplyBatch(() => undefined, 5_000)

describe('pickForTick', () => {
  const ready = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'ready' as const, id: `r${i}` }))
  const fresh = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'draft' as const, id: `d${i}` }))
  const base = { capRoom: 194, targetRoom: 94, aiRoom: 1738 }

  it('with email working takes written drafts first, then new ones, within the round, cap and target', () => {
    const picked = pickForTick([...fresh(30), ...ready(3)], { ...base, emailReady: true })
    expect(picked).toHaveLength(PER_ROUND)
    expect(picked.slice(0, 3).every((c) => c.kind === 'ready')).toBe(true)
    expect(pickForTick(fresh(30), { ...base, emailReady: true, targetRoom: 2 })).toHaveLength(2)
    expect(pickForTick(fresh(30), { ...base, emailReady: true, capRoom: 1 })).toHaveLength(1)
    // Out of AI quota: only drafts already written can go; nearly out: only as many as it covers.
    expect(pickForTick([...fresh(10), ...ready(2)], { ...base, emailReady: true, aiRoom: 1 })).toEqual(ready(2))
    expect(pickForTick(fresh(10), { ...base, emailReady: true, aiRoom: 5 })).toHaveLength(2)
  })

  it('while email is not ready writes new drafts ahead, never re-picking written ones', () => {
    const picked = pickForTick([...ready(3), ...fresh(40)], { ...base, emailReady: false })
    expect(picked).toHaveLength(PER_ROUND)
    expect(picked.every((c) => c.kind === 'draft')).toBe(true)
  })

  it('drafts ahead up to the batch target (or today\'s cap), counting the drafts already waiting', () => {
    expect(pickForTick([...ready(90), ...fresh(20)], { ...base, emailReady: false })).toHaveLength(4)
    expect(pickForTick([...ready(94), ...fresh(20)], { ...base, emailReady: false })).toEqual([])
    expect(pickForTick([...ready(5), ...fresh(20)], { ...base, emailReady: false, capRoom: 8 })).toHaveLength(3)
    expect(pickForTick(fresh(20), { ...base, emailReady: false, aiRoom: 1 })).toEqual([])
  })
})

describe('emailNotReadyNote', () => {
  it('says what waits and that it goes out after the reconnect', () => {
    expect(emailNotReadyNote('Gmail not connected (Settings → Email)', 6, 8)).toBe('Email not ready: Gmail not connected (Settings → Email). 6 queued and 8 more written and checked; they go out as soon as it works again.')
    expect(emailNotReadyNote('Gmail not connected (Settings → Email)', 0, 0)).toBe('Email not ready: Gmail not connected (Settings → Email).')
  })
})

describe('tickApplyBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(h.state, { emailReady: false, target: 100, queuedBefore: 6, jobs: Array.from({ length: 40 }, (_, i) => job(i)), apps: new Map(), waitingFor: [], batchIdWrites: [], counters: { drafted: 0, held: 0 }, suppressed: [] })
    vi.mocked(draftApplication).mockImplementation((async (jobId: string) => h.writeDraft(jobId)) as never)
  })

  it('keeps writing drafts round after round while Gmail is disconnected, but queues nothing', async () => {
    await tick()
    expect(draftApplication).toHaveBeenCalledTimes(40)
    expect(vi.mocked(draftApplication).mock.calls.every(([, opts]) => (opts as { fast?: boolean }).fast === true)).toBe(true)
    expect(evaluateAutoSend).not.toHaveBeenCalled()
    expect(h.state.batchIdWrites).toEqual([])
    expect(h.state.waitingFor.at(-1)).toBe('Email not ready: Gmail not connected (Settings → Email). 6 queued and 40 more written and checked; they go out as soon as it works again.')
  })

  it('stops drafting ahead once the batch target is covered', async () => {
    h.state.target = 20 // 6 already queued: 14 more
    await tick()
    expect(draftApplication).toHaveBeenCalledTimes(14)
  })

  it('queues drafts already written at once, without waiting for the new ones being written', async () => {
    h.state.emailReady = true
    h.state.jobs = [job(1), job(2), job(3), job(20), job(21)]
    h.writeDraft('job-20')
    h.writeDraft('job-21')
    const pending: Array<() => void> = []
    vi.mocked(draftApplication).mockImplementation(((jobId: string) => new Promise((resolve) => pending.push(() => resolve(h.writeDraft(jobId))))) as never)

    const running = tick()
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    await vi.waitFor(() => expect(evaluateAutoSend).toHaveBeenCalledTimes(2))
    expect([...h.state.batchIdWrites].sort()).toEqual(['app-job-20', 'app-job-21'])

    pending.forEach((resolve) => resolve())
    await running
    expect(evaluateAutoSend).toHaveBeenCalledTimes(5)
    expect(vi.mocked(evaluateAutoSend).mock.calls.every(([, opts]) => opts?.force === true && opts?.requirePassed === true)).toBe(true)
  })

  it('after a reconnect, the next tick queues everything written ahead without any AI call', async () => {
    await tick() // disconnected: 40 written ahead
    vi.mocked(draftApplication).mockClear()
    h.state.emailReady = true
    await tick()
    expect(draftApplication).not.toHaveBeenCalled()
    expect(evaluateAutoSend).toHaveBeenCalledTimes(40)
  })

  it('queues a draft written during the tick right away when Gmail comes back meanwhile', async () => {
    h.state.jobs = [job(1), job(2)]
    vi.mocked(draftApplication).mockImplementation((async (jobId: string) => {
      h.state.emailReady = true // reconnected while the AI was writing
      return h.writeDraft(jobId)
    }) as never)
    await tick()
    expect(evaluateAutoSend).toHaveBeenCalledTimes(2)
    expect([...h.state.batchIdWrites].sort()).toEqual(['app-job-1', 'app-job-2'])
  })

  it('retries once on the next model when Google reports the quota gone', async () => {
    h.state.jobs = [job(1)]
    const quota = Object.assign(new Error('Daily free-tier quota used up for gemini-3.8-flash on every key'), { name: 'NoKeyAvailableError' })
    vi.mocked(draftApplication).mockRejectedValueOnce(quota).mockImplementation((async (jobId: string) => h.writeDraft(jobId)) as never)
    await tick()
    expect(draftApplication).toHaveBeenCalledTimes(2)
    expect(h.state.counters).toEqual({ drafted: 1, held: 0 })
  })

  it('never picks a job whose address is on the block list (it would be held every round)', async () => {
    h.state.emailReady = true
    h.state.jobs = [job(1), job(2)]
    h.state.suppressed = ['careers@company1.de']
    await tick()
    expect(vi.mocked(draftApplication).mock.calls.map((c) => c[0])).toEqual(['job-2'])
  })

  it('does not spin on a written draft that keeps being held', async () => {
    h.state.emailReady = true
    h.state.jobs = [job(1)]
    h.writeDraft('job-1')
    vi.mocked(evaluateAutoSend).mockResolvedValueOnce({ outcome: 'review', reason: 'Daily send cap (200) reached' })
    await tick()
    expect(evaluateAutoSend).toHaveBeenCalledTimes(1)
    expect(h.state.counters.held).toBe(1)
  })

  it('does not burn through the list when every draft fails (AI outage)', async () => {
    vi.mocked(draftApplication).mockRejectedValue(new Error('503 This model is currently experiencing high demand'))
    await tick()
    expect(draftApplication).toHaveBeenCalledTimes(PER_ROUND)
    expect(h.state.counters.held).toBe(PER_ROUND)
  })
})
