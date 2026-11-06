import { describe, expect, it, vi } from 'vitest'
import { createPoliteFetch, hostKey, HostGate } from './host-gate'

describe('hostKey', () => {
  it('groups the tenants of an ATS', () => {
    expect(hostKey('https://boards-api.greenhouse.io/v1/boards/acme/jobs')).toBe('greenhouse.io')
    expect(hostKey('https://acme.recruitee.com/api/offers/')).toBe('recruitee.com')
    expect(hostKey('https://www.workable.com/api/accounts/acme')).toBe('workable.com')
    expect(hostKey('https://apply.workable.com/acme')).toBe('workable.com')
    expect(hostKey('https://acme.jobs.personio.de/xml')).toBe('personio.de')
  })
  it('puts company websites and bad URLs in "other"', () => {
    expect(hostKey('https://www.acme.com/careers')).toBe('other')
    expect(hostKey('notaurl')).toBe('other')
    expect(hostKey('https://notgreenhouse.io/x')).toBe('other')
  })
})

describe('HostGate', () => {
  it('never runs more requests than its concurrency', async () => {
    const gate = new HostGate({ concurrency: 2, minIntervalMs: 0 })
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await gate.acquire()
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        release()
      }),
    )
    expect(peak).toBe(2)
  })
  it('spaces request starts by the minimum interval', async () => {
    const gate = new HostGate({ concurrency: 4, minIntervalMs: 40 })
    const starts: number[] = []
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const release = await gate.acquire()
        starts.push(Date.now())
        release()
      }),
    )
    starts.sort((a, b) => a - b)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(35)
  })
  it('holds requests back after a penalty', async () => {
    const gate = new HostGate({ concurrency: 2, minIntervalMs: 0 })
    gate.penalize(60)
    const t = Date.now()
    const release = await gate.acquire()
    release()
    expect(Date.now() - t).toBeGreaterThanOrEqual(55)
  })
})

describe('createPoliteFetch', () => {
  it('replaces the caller signal with its own timeout and passes the rest through', async () => {
    const base = vi.fn(async (_u: unknown, init?: RequestInit) => new Response('{}', { status: 200, headers: { 'x-seen': String(Boolean(init?.signal)) } }))
    const f = createPoliteFetch(base as unknown as typeof fetch, { timeoutMs: 5000 })
    const aborted = new AbortController()
    aborted.abort()
    const res = await f('https://boards-api.greenhouse.io/v1/boards/acme/jobs', { headers: { a: 'b' }, signal: aborted.signal })
    expect(res.status).toBe(200)
    const init = base.mock.calls[0][1] as RequestInit
    expect(init.signal).not.toBe(aborted.signal)
    expect(init.signal?.aborted).toBe(false)
    expect(init.headers).toEqual({ a: 'b' })
  })
  it('pauses a host that answers 429', async () => {
    const base = vi.fn(async () => new Response('slow down', { status: 429 }))
    const f = createPoliteFetch(base as unknown as typeof fetch, { penaltyMs: 70 })
    await f('https://www.workable.com/api/accounts/a')
    const t = Date.now()
    await f('https://www.workable.com/api/accounts/b')
    expect(Date.now() - t).toBeGreaterThanOrEqual(60)
  })
})
