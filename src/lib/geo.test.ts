import { describe, expect, it } from 'vitest'
import { guessCountry, isRemoteLocation } from './geo'
import { extractEmails, htmlToText } from './text'

describe('guessCountry', () => {
  it.each([
    ['Dublin, Ireland', 'IE'],
    ['Dublin', 'IE'],
    ['Berlin (Hybrid)', 'DE'],
    ['Remote - Germany', 'DE'],
    ['Amsterdam, NL', 'NL'],
    ['München, Deutschland', 'DE'],
    ['London, UK', 'GB'],
    ['Warszawa', 'PL'],
    ['New York, NY', 'US'],
    ['United States-New York-Rome', 'US'],
    ['Rome, Italy', 'IT'],
    ['Rome', 'IT'],
    ['', undefined],
  ])('%s → %s', (input, expected) => {
    expect(guessCountry(input)).toBe(expected)
  })
  it('uses the fallback when nothing matches', () => {
    expect(guessCountry('Somewhere', 'IE')).toBe('IE')
  })
  it('detects remote', () => {
    expect(isRemoteLocation('Remote (EU)')).toBe(true)
    expect(isRemoteLocation('Dublin')).toBe(false)
  })
})

describe('text helpers', () => {
  it('converts html to text', () => {
    expect(htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>one</li><li>two</li></ul>')).toBe('Hello world\n- one\n- two')
  })
  it('extracts and ranks contact emails', () => {
    const emails = extractEmails('Send your CV to bob@acme.io or jobs@acme.io. Not to noreply@acme.io.')
    expect(emails).toEqual(['jobs@acme.io', 'bob@acme.io'])
  })
})

describe('countryNameVariants', () => {
  it('names the country of the person in the languages of European forms', async () => {
    const { countryNameVariants } = await import('./geo')
    const v = countryNameVariants('Portugal')
    expect(v).toContain('Portugal')
    expect(v).toContain('Portogallo')
    expect(v.some((n) => /^Portugal(ia|sko)$/.test(n))).toBe(true)
    expect(countryNameVariants('Nowhere Land')).toEqual(['Nowhere Land'])
  })
})
