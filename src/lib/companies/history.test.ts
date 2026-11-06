import { describe, expect, it } from 'vitest'
import { nextAvailable } from './history'

const day = 86_400_000
const now = new Date('2026-10-30T12:00:00Z')
const ago = (d: number) => new Date(now.getTime() - d * day)

describe('nextAvailable (company rule)', () => {
  it('is free when nothing was sent inside the window', () => {
    expect(nextAvailable([], 1, 15, now)).toBeNull()
    expect(nextAvailable([ago(20)], 1, 15, now)).toBeNull()
  })
  it('one per 15 days: free 15 days after the last send', () => {
    expect(nextAvailable([ago(5)], 1, 15, now)?.toISOString()).toBe(new Date(ago(5).getTime() + 15 * day).toISOString())
  })
  it('with a limit above one, waits for the oldest send that keeps the count at the limit', () => {
    expect(nextAvailable([ago(2)], 3, 30, now)).toBeNull()
    expect(nextAvailable([ago(2), ago(10), ago(20)], 3, 30, now)?.toISOString()).toBe(new Date(ago(20).getTime() + 30 * day).toISOString())
  })
  it('no window means no rule', () => {
    expect(nextAvailable([ago(1)], 1, 0, now)).toBeNull()
  })
})
