import { describe, expect, it } from 'vitest'
import { runPool } from './pool'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('runPool', () => {
  it('never runs more than the limit at once and runs every item', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    const r = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++
      peak = Math.max(peak, active)
      await sleep(5 + (n % 3) * 3)
      done.push(n)
      active--
    })
    expect(peak).toBe(3)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(r).toEqual({ started: 7, stopped: false })
  })

  it('stops taking new items once fn returns false; running ones finish', async () => {
    const seen: number[] = []
    const r = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      seen.push(n)
      await sleep(5)
      return n !== 2
    })
    expect(r.stopped).toBe(true)
    expect(seen.length).toBeLessThan(6)
    expect(seen).toContain(2)
  })

  it('honours shouldStop before starting each item', async () => {
    let calls = 0
    const r = await runPool([1, 2, 3, 4], 1, async () => {
      calls++
    }, () => calls >= 2)
    expect(calls).toBe(2)
    expect(r.stopped).toBe(true)
  })

  it('rethrows the first error after the running items finish', async () => {
    let finished = 0
    await expect(
      runPool([1, 2, 3], 3, async (n) => {
        if (n === 1) throw new Error('boom')
        await sleep(10)
        finished++
      }),
    ).rejects.toThrow('boom')
    expect(finished).toBe(2)
  })

  it('handles an empty list and odd limits', async () => {
    expect(await runPool([], 4, async () => undefined)).toEqual({ started: 0, stopped: false })
    expect((await runPool([1, 2], 0, async () => undefined)).started).toBe(2)
  })
})
