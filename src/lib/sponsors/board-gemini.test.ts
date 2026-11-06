import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { findBoardWithGemini, GeminiBreaker, normalizePointer } from './board-gemini'

describe('normalizePointer', () => {
  it('keeps plain domains and http(s) URLs, drops the rest', () => {
    expect(normalizePointer({ domain: 'https://www.Acme.com/x', careersUrl: 'https://acme.com/careers', boardUrl: '' })).toEqual({ domain: 'acme.com', careersUrl: 'https://acme.com/careers', boardUrl: null })
    expect(normalizePointer({ domain: 'unknown', careersUrl: 'acme.com/careers', boardUrl: 'ftp://x' })).toEqual({ domain: null, careersUrl: null, boardUrl: null })
  })
})

describe('GeminiBreaker', () => {
  it('opens after a run of failures and closes the streak on success', () => {
    const b = new GeminiBreaker(3)
    b.fail()
    b.fail()
    b.ok()
    b.fail()
    b.fail()
    expect(b.open).toBe(false)
    b.fail()
    expect(b.open).toBe(true)
  })
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('findBoardWithGemini', () => {
  const stats = () => ({ requests: 0, failures: 0 })

  it('accepts a board URL only after the live board answers with jobs', async () => {
    const f = vi.fn(async (url: unknown) => (String(url).includes('api.lever.co/v0/postings/acme') ? json([{ id: 1 }]) : new Response('no', { status: 404 }))) as unknown as typeof fetch
    const s = stats()
    const r = await findBoardWithGemini('Acme', 'acme.com', f, s, async () => ({ domain: 'acme.com', careersUrl: null, boardUrl: 'https://jobs.lever.co/acme' }))
    expect(r.hit).toMatchObject({ atsType: 'lever', atsSlug: 'acme', via: 'gemini' })
    expect(r.domain).toBe('acme.com')
    expect(s.requests).toBe(1)
  })

  it('never trusts a pointer to a board that does not exist', async () => {
    const f = vi.fn(async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    const r = await findBoardWithGemini('Acme', null, f, stats(), async () => ({ domain: 'acme.com', careersUrl: null, boardUrl: 'https://jobs.lever.co/acme' }))
    expect(r.hit).toBeNull()
  })

  it('rejects a live board that belongs to another company', async () => {
    const f = vi.fn(async (url: unknown) => (String(url).includes('workable') ? json({ name: 'Totally Different Ltd', jobs: [{ id: 1 }] }) : new Response('no', { status: 404 }))) as unknown as typeof fetch
    const r = await findBoardWithGemini('Acme Robotics', null, f, stats(), async () => ({ domain: null, careersUrl: null, boardUrl: 'https://apply.workable.com/acme' }))
    expect(r.hit).toBeNull()
  })

  it('reads the careers page Gemini named and verifies the board it links to', async () => {
    const f = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u === 'https://acme.com/careers') return new Response('<a href="https://boards.greenhouse.io/acmegh/jobs/1">x</a>', { status: 200 })
      if (u.includes('boards-api.greenhouse.io/v1/boards/acmegh/jobs')) return json({ jobs: [{ id: 1 }] })
      return new Response('no', { status: 404 })
    }) as unknown as typeof fetch
    const r = await findBoardWithGemini('Acme', null, f, stats(), async () => ({ domain: 'acme.com', careersUrl: 'https://acme.com/careers', boardUrl: null }))
    expect(r.hit).toMatchObject({ atsType: 'greenhouse', atsSlug: 'acmegh', via: 'gemini' })
  })
})
