import { beforeEach, describe, expect, it, vi } from 'vitest'

const update = vi.fn()
const createMany = vi.fn()
vi.mock('@/lib/db', () => ({ db: { boardDiscoveryRun: { update: (...a: unknown[]) => update(...a) }, boardDiscoveryLog: { createMany: (...a: unknown[]) => createMany(...a) } } }))
vi.mock('@/lib/notifications', () => ({ notify: vi.fn() }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))

import { BoardRunReporter } from './board-run'

beforeEach(() => {
  update.mockReset()
  createMany.mockReset()
})

describe('BoardRunReporter', () => {
  it('writes counters and buffered lines in one go and notices Stop', async () => {
    update.mockResolvedValue({ cancelRequested: true })
    createMany.mockResolvedValue({ count: 2 })
    const rep = new BoardRunReporter('run1')
    rep.total = 10
    rep.checked = 4
    rep.requests = 30
    rep.noBoard = 1
    rep.phase = 'find'
    rep.boardFound('greenhouse', 'slug', { total: 5, matching: 2 })
    rep.boardFound('lever', 'careers', { total: 3, matching: 0 })
    rep.boardFound('greenhouse', 'gemini', null)
    rep.add({ level: 'found', message: 'Acme: greenhouse/acme, 2 matching jobs', companyName: 'Acme', atsType: 'greenhouse', atsSlug: 'acme', relevantJobs: 2 })
    rep.add({ level: 'none', message: 'Beta: none' })
    await rep.flush()
    expect(update).toHaveBeenCalledTimes(1)
    const data = update.mock.calls[0][0].data
    expect(data).toMatchObject({
      total: 10,
      checked: 4,
      boardsFound: 3,
      boardsRelevant: 1,
      relevantJobs: 2,
      requests: 30,
      noBoard: 1,
      phase: 'find',
      perAtsCounts: { greenhouse: 2, lever: 1 },
      perMethod: { slug: { found: 1, saved: 1 }, careers: { found: 1, saved: 0 }, gemini: { found: 1, saved: 0 } },
    })
    expect(createMany.mock.calls[0][0].data).toHaveLength(2)
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({ runId: 'run1', level: 'found', relevantJobs: 2 })
    expect(rep.cancelRequested).toBe(true)
  })

  it('carries on from the counters of a run picked up again', () => {
    const rep = new BoardRunReporter('r', {
      total: 100,
      checked: 40,
      boardsFound: 9,
      boardsRelevant: 5,
      relevantJobs: 17,
      dead: 1,
      errors: 2,
      requests: 900,
      noBoard: 30,
      perAtsCounts: { lever: 4 },
      perMethod: { slug: { found: 6, saved: 4 } },
    })
    rep.boardFound('lever', 'slug', { total: 3, matching: 1 })
    expect(rep.boardsFound).toBe(10)
    expect(rep.boardsRelevant).toBe(6)
    expect(rep.relevantJobs).toBe(18)
    expect(rep.perAts).toEqual({ lever: 5 })
    expect(rep.perMethod.slug).toEqual({ found: 7, saved: 5 })
  })

  it('keeps the lines when the write fails and retries them', async () => {
    update.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ cancelRequested: false })
    createMany.mockResolvedValue({ count: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rep = new BoardRunReporter('run2')
    rep.add({ level: 'none', message: 'x' })
    await rep.flush()
    expect(createMany).not.toHaveBeenCalled()
    await rep.flush()
    expect(createMany.mock.calls[0][0].data).toHaveLength(1)
    spy.mockRestore()
  })

  it('does not write twice at once', async () => {
    let release: (v: { cancelRequested: boolean }) => void = () => undefined
    update.mockReturnValue(new Promise((r) => (release = r)))
    const rep = new BoardRunReporter('run3')
    const a = rep.flush()
    const b = rep.flush()
    expect(b).toBe(a)
    release({ cancelRequested: false })
    await a
    expect(update).toHaveBeenCalledTimes(1)
  })
})
