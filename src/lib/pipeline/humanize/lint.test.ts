import { describe, expect, it } from 'vitest'
import { autofixText, factMentioned, lintEmail, type LintContext } from './lint'

const ctx: LintContext = {
  companyName: 'Tines',
  mustHaveSkills: ['React', 'TypeScript', 'Node.js'],
  profileFacts: ['team of 10', 'HRMS', 'Northwind Labs', 'NestJS'],
  profileName: 'Alex Rivera',
  stopSkills: ['Rust', 'Go', 'Kubernetes'],
}

const GOOD_SUBJECT = 'Senior Frontend Engineer at Tines'
const GOOD_BODY = `Hi Sarah,

Your Senior Frontend Engineer posting mentions moving the Tines story editor to React 19 and TypeScript, and that is close to what I have spent the last two years on. At Northwind Labs I lead a team of 10 engineers building an HRMS product in React, NestJS and PostgreSQL, and I still review most of the frontend code myself.

The part of the role that interests me most is the workflow canvas. We built a drag and drop editor for internal automation last year, and the hardest problems were undo history and keeping 2,000 nodes responsive, which I would enjoy comparing notes on.

I'm based in Lisbon and could relocate to Dublin. I know the area well and can start within eight weeks of an offer. Would a short call next week work for you?

Alex Rivera`

describe('factMentioned', () => {
  it('matches on distinctive words, not verbatim phrases', () => {
    expect(factMentioned('at northwind labs i lead a team of 10 engineers', 'leads a team of 10 engineers at Northwind Labs')).toBe(true)
    expect(factMentioned('i built an hrms in react and postgresql', 'built an HRMS in React and PostgreSQL')).toBe(true)
    expect(factMentioned('i like engineering', 'leads a team of 10 engineers at Northwind Labs')).toBe(false)
  })
})

describe('autofixText', () => {
  it('replaces curly quotes, dashes and ellipsis', () => {
    expect(autofixText('“Hi” — it’s fine… ok!')).toBe('"Hi", it\'s fine... ok.')
  })
  it('turns mid-word em dashes into commas', () => {
    expect(autofixText('fast—reliable')).toBe('fast, reliable')
  })
})

describe('lintEmail', () => {
  it('passes a specific, plain email', () => {
    const r = lintEmail(GOOD_SUBJECT, GOOD_BODY, ctx)
    expect(r.errors).toEqual([])
    expect(r.passed).toBe(true)
    expect(r.stats.words).toBeGreaterThan(90)
    expect(r.stats.paragraphs).toBe(5)
  })

  it('flags banned buzzwords and openers', () => {
    const body = GOOD_BODY.replace('Your Senior', 'I am writing to express my interest. I want to delve into your Senior')
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    const msgs = r.errors.map((e) => e.match?.toLowerCase())
    expect(msgs).toContain('delve')
    expect(msgs).toContain('i am writing to')
  })

  it('flags the candidate written about in the third person (Risk Ledger draft)', () => {
    const body = GOOD_BODY.replace('At Northwind Labs I lead a team of 10 engineers', 'At Northwind Labs, where he leads a team of 10 engineers and still writes code,')
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    expect(r.errors.some((e) => e.rule === 'voice' && /he leads/i.test(e.match ?? ''))).toBe(true)
  })

  it('flags a made-up hobby (Games Workshop draft)', () => {
    const body = GOOD_BODY.replace('which I would enjoy comparing notes on.', 'much like how I enjoy painting miniature figures.')
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    expect(r.errors.some((e) => e.rule === 'facts')).toBe(true)
    // "I would enjoy comparing notes" is not a hobby.
    expect(lintEmail(GOOD_SUBJECT, GOOD_BODY, ctx).errors.some((e) => e.rule === 'facts')).toBe(false)
  })

  it('flags sentence-initial transitions', () => {
    const body = GOOD_BODY.replace('The part of the role', 'Furthermore, the part of the role')
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    expect(r.errors.some((e) => e.rule === 'banned-phrase' && /furthermore/i.test(e.match ?? ''))).toBe(true)
  })

  it('flags lists, bold and headers', () => {
    const body = GOOD_BODY + '\n\n- React\n- Node\n\n**Thanks**'
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    const messages = r.errors.map((e) => e.message)
    expect(messages).toContain('Bullet or numbered list')
    expect(messages).toContain('Bold/markdown emphasis')
  })

  it('requires the company name, a skill, a CV fact and a sign-off', () => {
    const body = `Hi there,

I build web applications and enjoy hard problems. I have shipped many products over the years and like working with small teams that own their roadmap. I would like to talk about the role and hear more about the team, the product and what the first six months would look like for a new engineer joining from abroad.

I can start soon and am happy to do a technical interview at any stage you prefer, including a take home task or a pairing session with someone from the team.

Thanks`
    const r = lintEmail('Frontend role', body, ctx)
    const messages = r.errors.map((e) => e.message)
    expect(messages.some((m) => m.includes('Company name'))).toBe(true)
    expect(messages.some((m) => m.includes('key skills'))).toBe(true)
    expect(messages.some((m) => m.includes('concrete fact'))).toBe(true)
    expect(messages.some((m) => m.includes('sign-off'))).toBe(true)
  })

  it('flags skills that are not on the profile', () => {
    const body = GOOD_BODY.replace('React, NestJS and PostgreSQL', 'React, Rust and PostgreSQL')
    const r = lintEmail(GOOD_SUBJECT, body, ctx)
    expect(r.errors.some((e) => e.rule === 'honesty' && e.match === 'Rust')).toBe(true)
  })

  it('enforces length and subject rules', () => {
    const r = lintEmail('Application for Senior Frontend Engineer position at Tines company', 'Hi. Alex Rivera', ctx)
    const rules = r.errors.map((e) => e.rule)
    expect(rules).toContain('length')
    expect(rules).toContain('subject')
  })

  it('accepts a shorter follow-up', () => {
    const body = `Hi Sarah,

Following up on my note from last week about the Senior Frontend Engineer role at Tines. I know hiring weeks get busy, so no rush, but if the role is still open I'd be glad to do a quick call whenever suits.

Alex Rivera`
    const r = lintEmail('Following up: Senior Frontend Engineer at Tines', body, { ...ctx, kind: 'follow_up', mustHaveSkills: [] })
    expect(r.errors).toEqual([])
  })
})
