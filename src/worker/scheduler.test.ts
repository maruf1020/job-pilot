import { describe, expect, it } from 'vitest'
import { SOURCE_IDS } from '@/lib/domain'
import { boardsRunCron, intervalToCron, LIGHT_RUN_SOURCES, lightRunSources } from './scheduler'

describe('intervalToCron', () => {
  it('maps minutes, hours and days', () => {
    expect(intervalToCron(30)).toBe('*/30 * * * *')
    expect(intervalToCron(5)).toBe('*/5 * * * *')
    expect(intervalToCron(60)).toBe('0 */1 * * *')
    expect(intervalToCron(720)).toBe('0 */12 * * *')
    expect(intervalToCron(1440)).toBe('0 9 */1 * *')
    expect(intervalToCron(2880)).toBe('0 9 */2 * *')
  })
  it('never goes below five minutes', () => {
    expect(intervalToCron(1)).toBe('*/5 * * * *')
  })
})

describe('boardsRunCron', () => {
  it('is off at 0 and when it would not run more often than the full search', () => {
    expect(boardsRunCron(0, 720)).toBeNull()
    expect(boardsRunCron(720, 720)).toBeNull()
    expect(boardsRunCron(1440, 720)).toBeNull()
  })

  it('runs every N hours at half past, away from the full runs on the hour', () => {
    expect(boardsRunCron(120, 720)).toBe('30 */2 * * *')
    expect(boardsRunCron(60, 720)).toBe('30 */1 * * *')
    expect(boardsRunCron(180, 720)).toBe('30 */3 * * *')
  })

  it('spreads sub-hour intervals half a step after the full slots', () => {
    expect(boardsRunCron(30, 120)).toBe('15,45 * * * *')
    expect(boardsRunCron(20, 120)).toBe('10,30,50 * * * *')
    // Never more often than every 10 minutes.
    expect(boardsRunCron(5, 120)).toBe('5,15,25,35,45,55 * * * *')
  })
})

describe('lightRunSources', () => {
  it('only names sources this build knows', () => {
    const known = lightRunSources()
    expect(known.every((id) => (SOURCE_IDS as readonly string[]).includes(id))).toBe(true)
    expect(known).toEqual(expect.arrayContaining(['ats', 'arbeitnow', 'freehire']))
    expect(known.length).toBeLessThanOrEqual(LIGHT_RUN_SOURCES.length)
  })
})
