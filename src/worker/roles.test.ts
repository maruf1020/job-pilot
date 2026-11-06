import { describe, expect, it } from 'vitest'
import { QUEUES } from '@/lib/queue'
import { parseWorkerRole, queuesForRole, runsApplySide, runsSearchSide, runsTelegramPoller, statusRowId } from './roles'

describe('worker roles', () => {
  it('parses WORKER_ROLE with "all" as the default', () => {
    expect(parseWorkerRole(undefined)).toBe('all')
    expect(parseWorkerRole('')).toBe('all')
    expect(parseWorkerRole(' Search ')).toBe('search')
    expect(parseWorkerRole('apply')).toBe('apply')
    expect(parseWorkerRole('agents')).toBe('all')
  })

  it('splits the queues between search and apply with nothing lost', () => {
    const search = queuesForRole('search')
    const apply = queuesForRole('apply')
    expect(search).toContain(QUEUES.searchRun)
    expect(search).toContain(QUEUES.searchBoards)
    expect(search).toContain(QUEUES.mailDispatch)
    expect(search).toContain(QUEUES.inboxScan)
    expect(search).toContain(QUEUES.applyBatch)
    expect(apply).toEqual(expect.arrayContaining([QUEUES.portalBatch, QUEUES.portalApply, QUEUES.portalStatus, QUEUES.browserControl]))
    expect(search.filter((q) => apply.includes(q))).toEqual([])
    expect(new Set([...search, ...apply])).toEqual(new Set(Object.values(QUEUES)))
    expect(new Set(queuesForRole('all'))).toEqual(new Set(Object.values(QUEUES)))
  })

  it('keeps browser work out of the search process and pipeline work out of the apply process', () => {
    expect(runsSearchSide('all') && runsApplySide('all')).toBe(true)
    expect(runsSearchSide('search')).toBe(true)
    expect(runsApplySide('search')).toBe(false)
    expect(runsSearchSide('apply')).toBe(false)
    expect(runsApplySide('apply')).toBe(true)
  })

  it('writes the status chip row from the search side and its own row from the apply side', () => {
    expect(statusRowId('all')).toBe(1)
    expect(statusRowId('search')).toBe(1)
    expect(statusRowId('apply')).toBe(2)
  })

  it('runs the Telegram poller in exactly one process: never in apply, so the split search + apply has one getUpdates reader', () => {
    expect(runsTelegramPoller('all')).toBe(true)
    expect(runsTelegramPoller('search')).toBe(true)
    expect(runsTelegramPoller('apply')).toBe(false)
    expect((['search', 'apply'] as const).filter(runsTelegramPoller)).toEqual(['search'])
  })
})
