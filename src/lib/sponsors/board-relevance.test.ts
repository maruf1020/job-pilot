import { describe, expect, it } from 'vitest'
import { countMatchingJobs, describeRelevance, inEuropeOrRemote, jobMatchesRules } from './board-relevance'

const rules = { stackFocus: ['react', 'typescript', 'node'], allowLead: true }
const longText = (s: string) => `${s} `.repeat(80)

describe('inEuropeOrRemote', () => {
  it('accepts European places by code or text', () => {
    expect(inEuropeOrRemote({ title: 'x', countryCode: 'DE' })).toBe(true)
    expect(inEuropeOrRemote({ title: 'x', location: 'Dublin, Ireland' })).toBe(true)
  })
  it('accepts remote when no place is named', () => {
    expect(inEuropeOrRemote({ title: 'x', remote: true })).toBe(true)
    expect(inEuropeOrRemote({ title: 'x', location: 'Remote' })).toBe(true)
  })
  it('rejects places outside Europe, remote or not', () => {
    expect(inEuropeOrRemote({ title: 'x', countryCode: 'US' })).toBe(false)
    expect(inEuropeOrRemote({ title: 'x', location: 'Austin, TX' })).toBe(false)
    expect(inEuropeOrRemote({ title: 'x', remote: true, countryCode: 'US' })).toBe(false)
  })
  it('needs a place or remote', () => {
    expect(inEuropeOrRemote({ title: 'x' })).toBe(false)
  })
})

describe('jobMatchesRules', () => {
  it('needs a developer title, the stack and Europe or remote', () => {
    expect(jobMatchesRules({ title: 'Senior Full Stack Engineer', description: longText('React and TypeScript services'), location: 'Berlin, Germany' }, rules)).toBe(true)
    expect(jobMatchesRules({ title: 'Senior Full Stack Engineer', description: longText('React and TypeScript services'), location: 'Austin, TX' }, rules)).toBe(false)
    expect(jobMatchesRules({ title: 'Sales Manager', description: longText('React'), location: 'Berlin, Germany' }, rules)).toBe(false)
  })
  it('judges the stack only on a real description', () => {
    expect(jobMatchesRules({ title: 'Software Engineer', description: longText('Java Spring Kotlin Scala'), location: 'Berlin, Germany' }, rules)).toBe(false)
    expect(jobMatchesRules({ title: 'Software Engineer', description: 'Join us', location: 'Berlin, Germany' }, rules)).toBe(true)
  })
  it('lead titles only count when allowed', () => {
    const job = { title: 'Tech Lead - React', description: 'React', countryCode: 'NL' }
    expect(jobMatchesRules(job, { ...rules, allowLead: true })).toBe(true)
    expect(jobMatchesRules(job, { ...rules, allowLead: false })).toBe(false)
  })
  it('an empty stack focus accepts any stack', () => {
    expect(jobMatchesRules({ title: 'Backend Engineer', description: longText('Java'), countryCode: 'IE' }, { stackFocus: [], allowLead: false })).toBe(true)
  })
})

describe('countMatchingJobs', () => {
  it('counts listed and matching jobs', () => {
    const r = countMatchingJobs(
      [
        { title: 'Frontend Developer', description: 'React', countryCode: 'FR' },
        { title: 'Backend Developer', description: 'Node.js TypeScript', remote: true },
        { title: 'Frontend Developer', description: 'React', countryCode: 'US' },
        { title: 'Account Executive', description: '', countryCode: 'FR' },
      ],
      rules,
    )
    expect(r).toEqual({ total: 4, matching: 2 })
  })
  it('an empty board matches nothing', () => {
    expect(countMatchingJobs([], rules)).toEqual({ total: 0, matching: 0 })
  })
})

describe('describeRelevance', () => {
  it('words the cases', () => {
    expect(describeRelevance({ total: 0, matching: 0 })).toBe('no jobs listed right now')
    expect(describeRelevance({ total: 12, matching: 0 })).toBe('no matching jobs (12 listed)')
    expect(describeRelevance({ total: 1, matching: 1 })).toBe('1 matching job')
    expect(describeRelevance({ total: 9, matching: 3 })).toBe('3 matching jobs of 9')
  })
})
