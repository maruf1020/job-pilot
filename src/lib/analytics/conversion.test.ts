import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/email/needs-action', () => ({ needsAction: vi.fn() }))
vi.mock('@/lib/email/suppression', () => ({ recentBounceRate: vi.fn() }))

import { computeScoreboard, MIN_GROUP, outcomeOf, scoreBand, type SendRow } from './conversion'
import { emailExperiment, subjectStyle } from './experiment'

const now = new Date('2026-10-23T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)

let n = 0
const row = (over: Partial<SendRow>): SendRow => ({
  id: `a${n++}`,
  sentAt: daysAgo(10),
  submittedVia: 'email',
  status: 'SENT',
  undelivered: false,
  countryCode: 'IE',
  addressSource: 'posting',
  score: 72,
  firstSeenAt: daysAgo(12),
  classes: [],
  experiment: null,
  batchId: null,
  autoRetry: false,
  ...over,
})

describe('outcome of one application', () => {
  it('counts only interview, positive and needs-info replies as genuine', () => {
    expect(outcomeOf(row({ classes: ['POSITIVE'] })).genuine).toBe(true)
    expect(outcomeOf(row({ classes: ['NEEDS_INFO'] })).genuine).toBe(true)
    expect(outcomeOf(row({ status: 'INTERVIEW' })).interview).toBe(true)
    const redirect = outcomeOf(row({ classes: ['APPLY_VIA_PORTAL', 'AUTO_REPLY'] }))
    expect(redirect.genuine).toBe(false)
    expect(redirect.redirect).toBe(true)
  })
  it('treats a bounce as delivered once a person answered', () => {
    expect(outcomeOf(row({ undelivered: true, classes: ['BOUNCE'] }))).toMatchObject({
      bounced: true,
      delivered: false,
    })
    expect(outcomeOf(row({ undelivered: true, classes: ['BOUNCE', 'REJECTION'] }))).toMatchObject({
      bounced: false,
      delivered: true,
      rejection: true,
    })
  })
})

describe('scoreboard', () => {
  it('judges only sends at least 7 days old', () => {
    const board = computeScoreboard([row({}), row({ sentAt: daysAgo(3) })], now)
    expect(board.overall.sent).toBe(1)
    expect(board.pending).toBe(1)
  })
  it('says too early under the minimum group size and gives a rate above it', () => {
    const small = computeScoreboard([row({ classes: ['POSITIVE'] }), row({})], now)
    expect(small.overall.tooEarly).toBe(true)
    expect(small.overall.rate).toBeNull()
    const rows = Array.from({ length: MIN_GROUP }, (_, i) =>
      row({ classes: i < 2 ? ['INTERVIEW_REQUEST'] : [] }),
    )
    const big = computeScoreboard(rows, now)
    expect(big.overall.rate).toBe(4)
    expect(big.measures.genuineRate.email.rate).toBe(4)
    expect(big.measures.interviews).toBe(2)
  })
  it('groups by channel, address source, score band and sender', () => {
    const board = computeScoreboard(
      [
        row({ submittedVia: 'agent', addressSource: null }),
        row({ addressSource: 'guessed', score: 85, batchId: 'b1' }),
        row({ score: null }),
      ],
      now,
    )
    expect(board.groups.channel.map((g) => g.key).sort()).toEqual(['email', 'form'])
    expect(board.groups.addressSource.map((g) => g.key).sort()).toEqual(['form', 'guessed', 'posting'])
    expect(board.groups.scoreBand.map((g) => g.key).sort()).toEqual(['70-79', '80+', 'no score'])
    expect(board.groups.sentBy.find((g) => g.key === 'batch')?.sent).toBe(1)
    expect(board.measures.formApplications).toBe(1)
  })
  it('measures how many applications went out within 7 days of the job being found', () => {
    const board = computeScoreboard(
      [
        row({ firstSeenAt: daysAgo(12) }),
        row({ firstSeenAt: daysAgo(30) }),
        row({ sentAt: daysAgo(40), firstSeenAt: daysAgo(41) }),
      ],
      now,
    )
    expect(board.measures.appliedWithin7dOf).toBe(2)
    expect(board.measures.appliedWithin7d).toBe(50)
  })
  it('score bands', () => {
    expect(scoreBand(59)).toBe('under 60')
    expect(scoreBand(60)).toBe('60-69')
    expect(scoreBand(80)).toBe('80+')
  })
})

describe('experiment record', () => {
  it('recognises the subject style and who sent it', () => {
    expect(subjectStyle('Senior Software Engineer application', 'Senior Software Engineer')).toBe(
      'role title',
    )
    expect(subjectStyle('Open to a chat?', 'Senior Software Engineer')).toBe('question')
    const e = emailExperiment({
      subject: 'Hello',
      body: 'one two three',
      jobTitle: 'Engineer',
      promptVersion: 'v3',
      model: 'm',
      cvAttached: true,
      batchId: 'b',
      autoRetry: false,
    })
    expect(e).toMatchObject({
      channel: 'email',
      words: 3,
      sentBy: 'batch',
      cvAttached: true,
      promptVersion: 'v3',
    })
  })
})
