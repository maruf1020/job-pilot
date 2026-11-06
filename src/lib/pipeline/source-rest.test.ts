import { describe, expect, it } from 'vitest'
import { boardResting, restAfter } from './source-rest'

const H = 3_600_000

describe('restAfter (freehire 429, Adzuna 503, Workday boards 500 on every run)', () => {
  it('rests 6 hours after too many requests or a block', () => {
    expect(restAfter('[freehire] HTTP 429 from freehire.me')?.ms).toBe(6 * H)
    expect(restAfter('[linkedin] LinkedIn is rate limiting this IP (HTTP 429); try again later')?.ms).toBe(6 * H)
    expect(restAfter('[x] HTTP 403 Forbidden')?.ms).toBe(6 * H)
  })
  it('rests 12 hours when the server fails', () => {
    expect(restAfter('[adzuna] HTTP 503 from api.adzuna.com')?.ms).toBe(12 * H)
    expect(restAfter('[ats] HTTP 500 from truist.wd1.myworkdayjobs.com')?.ms).toBe(12 * H)
    expect(restAfter('fetch failed')?.ms).toBe(12 * H)
  })
  it('does not rest on errors that are not the source being busy or down', () => {
    expect(restAfter('Unexpected token < in JSON at position 0')).toBeNull()
    expect(restAfter('[ats] HTTP 404 from api.lever.co')).toBeNull()
  })
})

describe('boardResting', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  it('skips a board that failed with a server error less than 12 hours ago', () => {
    expect(boardResting('[ats] HTTP 500 from oxford.wd5.myworkdayjobs.com', new Date(now.getTime() - 3 * H), now)).toBe(true)
    expect(boardResting('[ats] HTTP 422 from hedgeserv.wd1.myworkdayjobs.com', new Date(now.getTime() - 11 * H), now)).toBe(true)
  })
  it('asks it again after the rest, and never rests a healthy or not-found board', () => {
    expect(boardResting('[ats] HTTP 500 from oxford.wd5.myworkdayjobs.com', new Date(now.getTime() - 13 * H), now)).toBe(false)
    expect(boardResting(null, new Date(now.getTime() - H), now)).toBe(false)
    expect(boardResting('[ats] HTTP 404 from api.lever.co', new Date(now.getTime() - H), now)).toBe(false)
  })
})
