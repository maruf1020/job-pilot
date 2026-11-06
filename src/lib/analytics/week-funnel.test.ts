import { describe, expect, it } from 'vitest'
import { toFunnel } from './week-funnel'

describe('toFunnel', () => {
  it('orders the steps and gives each the share of the step before', () => {
    const steps = toFunnel({ found: 2000, fit: 400, applied: 120, replied: 12, nextStep: 3 })
    expect(steps.map((s) => s.key)).toEqual(['found', 'fit', 'applied', 'replied', 'nextStep'])
    expect(steps[0].pctOfPrev).toBeNull()
    expect(steps[1].pctOfPrev).toBe(20)
    expect(steps[2].pctOfPrev).toBe(30)
    expect(steps[3].pctOfPrev).toBe(10)
    expect(steps[4].pctOfPrev).toBe(25)
  })
  it('leaves the share empty after a zero step', () => {
    const steps = toFunnel({ found: 10, fit: 0, applied: 2, replied: 0, nextStep: 0 })
    expect(steps[2].pctOfPrev).toBeNull()
    expect(steps[4].pctOfPrev).toBeNull()
  })
})
