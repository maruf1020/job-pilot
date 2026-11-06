import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { categorize, latestForQueue, latestPerApplication, mergeWalls, usableOptions, type QueueAttempt } from './queue'

const job = {
  id: 'j',
  title: 'Software Engineer',
  companyName: 'Acme',
  countryCode: 'IE',
  finalScore: 80,
  url: 'https://acme.com/jobs/1',
}
const qa = (over: Partial<QueueAttempt>): QueueAttempt => ({
  attemptId: 'a',
  applicationId: 'app',
  status: 'NEEDS_HUMAN',
  reason: null,
  host: 'acme.com',
  atsType: null,
  finishedAt: null,
  startedAt: new Date(),
  screenshots: 0,
  hasTab: false,
  job,
  ...over,
})

describe('queue sections', () => {
  it('puts CAPTCHA stops first, sign-in and account walls next, other waiting forms last', () => {
    expect(
      categorize({ status: 'CANCELLED', reason: 'CAPTCHA, waiting for you: open this application' }),
    ).toBe('captcha')
    expect(
      categorize({
        status: 'NEEDS_HUMAN',
        reason: 'itjobs.pt asks you to sign in. Log in once in the apply browser',
      }),
    ).toBe('wall')
    expect(
      categorize({ status: 'NEEDS_HUMAN', reason: 'Could not fill: "Choose password:", "Retype password:"' }),
    ).toBe('wall')
    expect(categorize({ status: 'NEEDS_HUMAN', reason: 'Needs your answer: notice period' })).toBe('waiting')
    expect(categorize({ status: 'AWAITING_REVIEW', reason: null })).toBe('waiting')
    // A cancelled attempt that is not a CAPTCHA or a wall waits for nobody.
    expect(categorize({ status: 'CANCELLED', reason: 'The posting looks closed or removed' })).toBeNull()
    expect(categorize({ status: 'SUBMITTED', reason: null })).toBeNull()
    expect(categorize({ status: 'RUNNING', reason: 'captcha' })).toBeNull()
  })
  it('keeps only the newest attempt per application', () => {
    const rows = [
      { applicationId: 'x', id: 3 },
      { applicationId: 'y', id: 2 },
      { applicationId: 'x', id: 1 },
    ]
    expect(latestPerApplication(rows).map((r) => r.id)).toEqual([3, 2])
  })
})

describe('walls', () => {
  it('merges the host table with hosts seen behind a wall, busiest first', () => {
    const walls = mergeWalls(
      [
        {
          host: 'jobs.example.com',
          kind: 'sign-in-wall',
          loggedIn: true,
          skipUntil: null,
          attempts: 4,
          submitted: 1,
          lastReason: 'sign in',
        },
        {
          host: 'other.com',
          kind: 'direct-form',
          loggedIn: false,
          skipUntil: null,
          attempts: 9,
          submitted: 9,
          lastReason: null,
        },
      ],
      [
        qa({ host: 'itjobs.pt', reason: 'itjobs.pt asks you to sign in', applicationId: 'a1' }),
        qa({ host: 'itjobs.pt', reason: 'itjobs.pt asks you to sign in', applicationId: 'a2' }),
        qa({
          host: 'jobs.example.com',
          reason: 'creates an account as part of applying',
          applicationId: 'a3',
        }),
      ],
    )
    expect(walls.map((w) => [w.host, w.waiting])).toEqual([
      ['itjobs.pt', 2],
      ['jobs.example.com', 1],
    ])
    expect(walls[1].loggedIn).toBe(true)
    expect(walls[0].kind).toBe('sign-in-wall')
    expect(walls[0].examples).toHaveLength(2)
  })
})

describe('question options', () => {
  it('drops radio values read as "on", empty labels and repeats', () => {
    expect(usableOptions(['on', 'on'])).toEqual([])
    expect(usableOptions(['', ' ', 'Yes', 'No', 'Yes'])).toEqual(['Yes', 'No'])
  })
})

describe('latestForQueue', () => {
  it('keeps a job the user opened with AI in the list, marked as opening', () => {
    const rows = [
      { id: 4, applicationId: 'a', status: 'QUEUED', batchId: null },
      { id: 3, applicationId: 'a', status: 'NEEDS_HUMAN', batchId: 'b1' },
      { id: 2, applicationId: 'c', status: 'QUEUED', batchId: 'b1' },
      { id: 1, applicationId: 'c', status: 'NEEDS_HUMAN', batchId: 'b1' },
    ]
    expect(latestForQueue(rows).map((r) => [r.id, r.opening])).toEqual([
      [3, 'QUEUED'],
      [2, null],
    ])
  })
})

describe('latestForQueue after a worker restart', () => {
  it('ignores a run the restart cancelled and shows the attempt before it', () => {
    const rows = [
      { id: 2, applicationId: 'a', status: 'CANCELLED', batchId: null, error: 'Worker restarted to load fixes; the batch picks the job again' },
      { id: 1, applicationId: 'a', status: 'NEEDS_HUMAN', batchId: 'b1', error: null },
    ]
    expect(latestForQueue(rows).map((r) => r.id)).toEqual([1])
  })
})
