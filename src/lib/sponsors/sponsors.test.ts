import { describe, expect, it } from 'vitest'
import { parseWorkdaySlug } from '@/lib/sources/ats'
import { namesMatch, slugCandidates } from './boards'
import { parseCsv } from './registers'

describe('sponsor register CSV parsing', () => {
  it('handles quoted fields with commas, quotes and newlines', () => {
    const rows = parseCsv('Organisation Name,Town/City,County,Type & Rating,Route\r\n"Acme, Ltd",London,,Worker (A rating),Skilled Worker\n"Multi\nLine ""Co""",Leeds,,Worker (A rating),Skilled Worker\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['Acme, Ltd', 'London', '', 'Worker (A rating)', 'Skilled Worker'])
    expect(rows[2][0]).toBe('Multi\nLine "Co"')
  })
})

describe('board slug guesses', () => {
  it('derives slugs from the name and domain, most likely first', () => {
    // The domain label is the likeliest slug, so it comes first.
    expect(slugCandidates('Acme Technologies Ltd', 'https://www.acme.io')).toEqual(['acme', 'acmetechnologies', 'acme-technologies'])
    expect(slugCandidates('Flipdish', 'flipdish.com')).toEqual(['flipdish'])
    expect(slugCandidates('Toast, Inc.', null)).toEqual(['toast'])
    expect(slugCandidates('Delivery Hero SE (Berlin)', 'deliveryhero.com')).toEqual(['deliveryhero', 'delivery-hero', 'delivery'])
  })
})

describe('company name matching for board hits', () => {
  it('accepts the same company under a different legal form and rejects strangers', () => {
    expect(namesMatch('Bromcom Computers Plc', 'Bromcom')).toBe(true)
    expect(namesMatch('KP Snacks', 'KP Snacks Ltd')).toBe(true)
    expect(namesMatch('T.E.S', 'Tes Global')).toBe(true)
    expect(namesMatch('Accenture', 'Acme Widgets')).toBe(false)
    expect(namesMatch('Imc', 'Imperial Marketing Co')).toBe(false)
  })
})

describe('Workday slugs', () => {
  it('parses tenant, site and data centre', () => {
    expect(parseWorkdaySlug('mastercard/CorporateCareers@wd1')).toEqual({ tenant: 'mastercard', site: 'CorporateCareers', wd: 'wd1' })
    expect(parseWorkdaySlug('Salesforce/External_Career_Site@WD12')).toEqual({ tenant: 'salesforce', site: 'External_Career_Site', wd: 'wd12' })
    expect(parseWorkdaySlug('nonsense')).toBeNull()
  })
})
