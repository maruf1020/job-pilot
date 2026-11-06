import { describe, expect, it } from 'vitest'
import { normalizeCompany, normalizeTitle } from '@/lib/text'
import { buildDedupeKey } from './dedupe'

describe('dedupe', () => {
  it('ignores legal suffixes and gender tags', () => {
    const a = buildDedupeKey('Acme Technologies Ltd.', 'Senior Software Engineer (m/f/d)', 'DE')
    const b = buildDedupeKey('ACME Technologies', 'Senior Software Engineer', 'de')
    expect(a).toBe(b)
  })
  it('separates by country', () => {
    expect(buildDedupeKey('Acme', 'Engineer', 'IE')).not.toBe(buildDedupeKey('Acme', 'Engineer', 'DE'))
  })
  it('normalizes company names', () => {
    expect(normalizeCompany('Stripe, Inc.')).toBe('stripe')
    expect(normalizeCompany('Zalando SE')).toBe('zalando')
    expect(normalizeCompany('Trade Republic Bank GmbH')).toBe('trade republic bank')
  })
  it('normalizes titles', () => {
    expect(normalizeTitle('Full-Stack Developer (w/m/d) - React')).toBe('full stack developer react')
  })
})
