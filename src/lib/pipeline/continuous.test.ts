import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/settings/service', () => ({ getSettings: vi.fn() }))

import { shouldStartContinuous } from './continuous'

describe('continuous search', () => {
  const now = Date.parse('2026-10-30T21:00:00Z')
  const base = { enabled: true, running: false, lastFinishedAt: new Date(now - 5 * 60_000), pauseMinutes: 2 }

  it('starts the next loop once the pause after the last run is over', () => {
    expect(shouldStartContinuous(base, now)).toBe(true)
    expect(shouldStartContinuous({ ...base, lastFinishedAt: new Date(now - 60_000) }, now)).toBe(false)
    expect(shouldStartContinuous({ ...base, pauseMinutes: 0, lastFinishedAt: new Date(now - 1000) }, now)).toBe(true)
    expect(shouldStartContinuous({ ...base, lastFinishedAt: null }, now)).toBe(true)
  })

  it('never starts while off or while a run is going', () => {
    expect(shouldStartContinuous({ ...base, enabled: false }, now)).toBe(false)
    expect(shouldStartContinuous({ ...base, running: true }, now)).toBe(false)
  })
})
