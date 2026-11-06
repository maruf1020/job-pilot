import { beforeEach, describe, expect, it, vi } from 'vitest'

// The poller runs against fakes only: no database, no Gmail, no AI.
const h = vi.hoisted(() => {
  const state = { token: true as boolean, deleted: 0 }
  const db = {
    application: {
      findMany: vi.fn(async () => Array.from({ length: 5 }, (_, i) => ({ id: `app-${i}`, threadId: `thread-${i}`, sentAt: new Date('2026-10-07T23:00:00Z'), messages: [] }))),
      update: vi.fn(async (a: unknown) => a),
    },
    emailMessage: {
      findUnique: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', ...data })),
    },
    applicationEvent: { create: vi.fn(async () => ({})) },
    oAuthToken: {
      findUnique: vi.fn(async () => (state.token ? { accountEmail: 'alex.rivera@example.com' } : null)),
      deleteMany: vi.fn(async () => {
        const count = state.token ? 1 : 0
        state.token = false
        state.deleted += count
        return { count }
      }),
    },
    notification: { findFirst: vi.fn(async () => null) },
  }
  return { state, db }
})

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/notifications', () => ({ notify: vi.fn(async () => null) }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn(async () => ({ email: { provider: 'gmail' } })) }))
vi.mock('./gmail', () => ({ gmailGetThread: vi.fn(), gmailSend: vi.fn(), gmailTestConnection: vi.fn() }))
vi.mock('./smtp', () => ({ smtpSend: vi.fn(), imapFindReplies: vi.fn(async () => []) }))
vi.mock('@/lib/ai/gemini', () => ({ generateJson: vi.fn() }))
vi.mock('@/lib/ai/prompts', () => ({ classifyReplyPrompt: vi.fn(), followUpPrompt: vi.fn() }))
vi.mock('@/lib/ai/schemas', () => ({ draftSchema: {}, replyClassificationSchema: {} }))
vi.mock('@/lib/pipeline/contacts', () => ({ rotateContactAfterBounce: vi.fn() }))
vi.mock('@/lib/pipeline/decide', () => ({ mailProviderReady: vi.fn(async () => ({ ready: true })) }))
vi.mock('@/lib/pipeline/humanize/loop', () => ({ humanizeLoop: vi.fn() }))
vi.mock('@/lib/pipeline/humanize/phrases', () => ({ getBannedPhrases: vi.fn() }))
vi.mock('@/lib/pipeline/profile', () => ({ getProfileForPrompt: vi.fn() }))

import { notify } from '@/lib/notifications'
import { gmailGetThread, gmailTestConnection } from './gmail'
import { isMailAuthError, verifyMailbox } from './send'
import { correctClassification, pollReplies } from './track'

describe('correcting a reply type', () => {
  const message = (classification: string, status: string, others: string[] = []) => ({
    id: 'm1',
    direction: 'INBOUND',
    classification,
    classificationMeta: { summary: 's' },
    receivedAt: new Date('2026-10-20T10:00:00Z'),
    application: { id: 'app-1', status, repliedAt: new Date('2026-10-20T10:00:00Z'), messages: others.map((c) => ({ classification: c })) },
  })
  const statusSet = () => (vi.mocked(h.db.application.update).mock.calls[0]?.[0] as { data: { status?: string } } | undefined)?.data.status
  beforeEach(() => vi.clearAllMocks())

  it('moves the application like a new reply of that type', async () => {
    h.db.emailMessage.findUnique.mockResolvedValueOnce(message('OTHER', 'REPLIED'))
    await correctClassification('m1', 'INTERVIEW_REQUEST')
    expect(statusSet()).toBe('INTERVIEW')
    const saved = vi.mocked(h.db.emailMessage.update).mock.calls[0][0] as { data: { classification: string; classificationMeta: { correctedFrom: string } } }
    expect(saved.data.classification).toBe('INTERVIEW_REQUEST')
    expect(saved.data.classificationMeta.correctedFrom).toBe('OTHER')
  })
  it('never moves an interview back to a plain reply, but a rejection still counts', async () => {
    h.db.emailMessage.findUnique.mockResolvedValueOnce(message('OTHER', 'INTERVIEW'))
    await correctClassification('m1', 'POSITIVE')
    expect(h.db.application.update).not.toHaveBeenCalled()
    h.db.emailMessage.findUnique.mockResolvedValueOnce(message('OTHER', 'INTERVIEW'))
    await correctClassification('m1', 'REJECTION')
    expect(statusSet()).toBe('REJECTED')
  })
  it('puts the application back to Sent when the only reply was really an auto-reply', async () => {
    h.db.emailMessage.findUnique.mockResolvedValueOnce(message('POSITIVE', 'REPLIED', ['BOUNCE']))
    await correctClassification('m1', 'AUTO_REPLY')
    expect(statusSet()).toBe('SENT')
    vi.clearAllMocks()
    h.db.emailMessage.findUnique.mockResolvedValueOnce(message('POSITIVE', 'REPLIED', ['NEEDS_INFO']))
    await correctClassification('m1', 'AUTO_REPLY')
    expect(h.db.application.update).not.toHaveBeenCalled()
  })
})

describe('mailbox connection errors', () => {
  it('tells a dead connection from other failures', () => {
    for (const m of ['invalid_grant', 'Token has been expired or revoked.', 'Gmail is not connected', 'Invalid Credentials', '535 5.7.8 Username and Password not accepted']) expect(isMailAuthError(m), m).toBe(true)
    for (const m of ['socket hang up', 'Requested entity was not found.', 'Rate Limit Exceeded']) expect(isMailAuthError(m), m).toBe(false)
  })
})

describe('reply polling with an expired Gmail token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(h.state, { token: true, deleted: 0 })
  })

  it('stops at the first refused thread, forgets the token and asks once to reconnect', async () => {
    vi.mocked(gmailGetThread).mockRejectedValue(new Error('invalid_grant'))
    const lines: string[] = []
    expect(await pollReplies((m) => lines.push(m))).toBe(0)
    expect(gmailGetThread).toHaveBeenCalledTimes(1)
    expect(h.db.oAuthToken.deleteMany).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notify).mock.calls[0]?.[1]).toBe('Gmail connection expired')
    expect(lines.some((l) => /reply polling stops until you reconnect/.test(l))).toBe(true)
  })

  it('does not try Gmail at all while it is not connected', async () => {
    h.state.token = false
    const lines: string[] = []
    expect(await pollReplies((m) => lines.push(m))).toBe(0)
    expect(gmailGetThread).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(lines).toEqual(['Gmail is not connected; reply polling resumes after you reconnect (Settings → Email)'])
  })

  it('keeps going past a single thread that fails for another reason', async () => {
    vi.mocked(gmailGetThread).mockRejectedValueOnce(new Error('Requested entity was not found.')).mockResolvedValue([])
    expect(await pollReplies(() => undefined)).toBe(0)
    expect(gmailGetThread).toHaveBeenCalledTimes(5)
    expect(h.db.oAuthToken.deleteMany).not.toHaveBeenCalled()
  })
})

describe('verifyMailbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(h.state, { token: true, deleted: 0 })
  })

  it('reports an expired token before anything is drafted, and only once', async () => {
    vi.mocked(gmailTestConnection).mockRejectedValue(new Error('invalid_grant'))
    expect(await verifyMailbox()).toEqual({ ready: false, reason: 'the Gmail connection has expired; reconnect in Settings → Email' })
    expect(h.state.deleted).toBe(1)
    expect(notify).toHaveBeenCalledTimes(1)
    await verifyMailbox()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does not treat a network hiccup as a broken connection', async () => {
    vi.mocked(gmailTestConnection).mockRejectedValue(new Error('socket hang up'))
    expect(await verifyMailbox()).toEqual({ ready: true })
    expect(h.db.oAuthToken.deleteMany).not.toHaveBeenCalled()
  })
})
