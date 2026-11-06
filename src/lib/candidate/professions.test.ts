import { describe, expect, it } from 'vitest'
import { PROFESSIONS } from './context'
import { PROFESSION_DICTIONARY, isExactTargetTitle, looksLikeProfessionRole, matchesAnyTarget, normalizeSeniority, seniorityAllowed, seniorityOf, titleMatchesTarget } from './professions'

describe('profession dictionary', () => {
  it('has an entry for every profession', () => {
    for (const p of PROFESSIONS) expect(PROFESSION_DICTIONARY[p.id].id).toBe(p.id)
  })
})

describe('titleMatchesTarget', () => {
  it('matches target titles word by word, levels and teams aside', () => {
    expect(matchesAnyTarget('Senior UX/UI Designer - Payments', ['UX Designer'])).toBe(true)
    expect(matchesAnyTarget('Product Designers (m/f/d)', ['Product Designer'])).toBe(true)
    expect(matchesAnyTarget('Product Manager', ['Product Designer'])).toBe(false)
    expect(isExactTargetTitle('Product Designer II', ['Product Designer'])).toBe(true)
    expect(isExactTargetTitle('Senior Product Designer, Growth', ['Product Designer'])).toBe(true)
    expect(isExactTargetTitle('Product Design Lead', ['Product Designer'])).toBe(false)
  })
  it('keeps each field on its own titles', () => {
    expect(titleMatchesTarget('Visual Designer', [], 'design')).toBe(true)
    expect(titleMatchesTarget('Interior Designer', [], 'design')).toBe(false)
    expect(titleMatchesTarget('Data Analyst', [], 'data')).toBe(true)
    expect(titleMatchesTarget('Data Entry Clerk', [], 'data')).toBe(false)
    expect(titleMatchesTarget('Senior Product Manager', [], 'product')).toBe(true)
    expect(titleMatchesTarget('Product Designer', [], 'product')).toBe(false)
    expect(titleMatchesTarget('Content Marketing Manager', [], 'marketing')).toBe(true)
    expect(titleMatchesTarget('Account Executive', [], 'sales')).toBe(true)
    expect(titleMatchesTarget('HR Business Partner', [], 'operations')).toBe(true)
    expect(titleMatchesTarget('Frontend Developer', [], 'software')).toBe(true)
    expect(titleMatchesTarget('Sales Engineer', [], 'software')).toBe(false)
  })
  it('lets the open "other" profession take any title, or only its targets', () => {
    expect(titleMatchesTarget('Barista', [], 'other')).toBe(true)
    expect(titleMatchesTarget('Barista', ['Teacher'], 'other')).toBe(false)
    expect(titleMatchesTarget('Primary School Teacher', ['Teacher'], 'other')).toBe(true)
  })
})

describe('seniority', () => {
  it('reads the level of a title', () => {
    expect(seniorityOf('Senior Product Designer')).toBe('senior')
    expect(seniorityOf('UX Design Intern')).toBe('junior')
    expect(seniorityOf('Principal Data Scientist')).toBe('staff')
    expect(seniorityOf('Design Manager', 'design')).toBe('manager')
    expect(seniorityOf('Account Manager', 'sales')).toBe('mid')
  })
  it('normalises free-text levels and checks them', () => {
    expect(normalizeSeniority(['Senior', 'entry level', 'Principal'])).toEqual(['junior', 'senior', 'staff'])
    expect(seniorityAllowed('Junior Designer', ['senior'], 'design')).toBe(false)
    expect(seniorityAllowed('Designer', ['senior'], 'design')).toBe(true)
    expect(seniorityAllowed('Junior Designer', [], 'design')).toBe(true)
  })
})

describe('looksLikeProfessionRole', () => {
  it('reads the title first, then the description', () => {
    expect(looksLikeProfessionRole('Brand Designer', '', 'design')).toBe(true)
    expect(looksLikeProfessionRole('Team Member', 'Build dashboards in Tableau with SQL and Python.', 'data')).toBe(true)
    expect(looksLikeProfessionRole('Team Member', 'Serve customers at the till.', 'data')).toBe(false)
    expect(looksLikeProfessionRole('Anything', '', 'other')).toBe(true)
  })
})
