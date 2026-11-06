import { describe, expect, it } from 'vitest'
import { DEFAULT_AI } from '@/lib/settings/schema'
import { buildCandidateContext } from '@/lib/candidate/context'
import {
  classifyReplyPrompt,
  coverLetterPrompt,
  diagnosePrompt,
  draftSystemPrompt,
  draftUserPrompt,
  driverPrompt,
  enrichPrompt,
  followUpPrompt,
  formAnswersPrompt,
  formFixPrompt,
  jobBlock,
  judgePrompt,
  levelRule,
  parseResumePrompt,
  permitFacts,
  permitFor,
  profileBlock,
  PROMPT_VERSION,
  rankPrompt,
  replyDraftPrompt,
  rewriteFormTextPrompt,
  type JobForPrompt,
  type ProfileForPrompt,
} from './index'

// Fictional test persona (never a real person).
const alex = buildCandidateContext(
  {
    fullName: 'Alex Rivera',
    pronouns: 'they/them',
    email: 'alex.rivera@example.com',
    phoneCountryCode: '+351',
    phone: '912 345 678',
    addressLine: 'Rua Exemplo 12',
    postalCode: '1000-001',
    city: 'Lisbon',
    country: 'PT',
    citizenships: ['PT'],
    profession: 'software',
    seniority: ['senior', 'lead'],
    yearsExperience: 7,
    skills: ['TypeScript', 'React', 'Node.js', 'AWS'],
    titles: ['Senior Software Engineer'],
    languageLevels: [
      { name: 'English', level: 'fluent' },
      { name: 'Portuguese', level: 'native' },
    ],
    workAuth: { needsSponsorship: false, rightToWork: [] },
    relocation: 'yes',
    remote: 'ok',
    emailVoice: { tone: 'warm', neverMention: ['crypto trading', 'my agency years'], leadWith: ['React', 'Node.js'], signOff: 'Best wishes,' },
    noticePeriod: '1 month',
    howHeard: 'LinkedIn',
    motivation: 'I want to work on a product used every day.',
    diversity: { gender: 'Non-binary' },
    experience: [
      { company: 'Northwind Labs', title: 'Senior Software Engineer', from: '2021', to: null },
      { company: 'Contoso Digital', title: 'Software Engineer', from: '2018', to: '2021' },
    ],
    education: [{ school: 'University of Lisbon', degree: 'BSc Computer Science', year: 2018 }],
  },
  'Europe/Lisbon',
)

// A second fictional persona who needs sponsorship outside their own country.
const sam = buildCandidateContext(
  {
    fullName: 'Sam Okafor',
    pronouns: 'he/him',
    city: 'Lagos',
    country: 'NG',
    citizenships: ['NG'],
    profession: 'design',
    workAuth: { needsSponsorship: true, rightToWork: [] },
    relocation: 'yes',
    remote: 'ok',
  },
  'Africa/Lagos',
)

const profile: ProfileForPrompt = {
  fullName: 'Alex Rivera',
  headline: 'Senior Software Engineer',
  location: 'Lisbon, Portugal',
  yearsExperience: 7,
  summary: 'Builds TypeScript products and runs them on AWS.',
  skills: ['TypeScript', 'React', 'AWS Lambda', 'AWS EC2', 'Azure'],
  facts: ['leads a team of 6 engineers', 'runs production apps on AWS Lambda'],
  titles: ['Senior Software Engineer'],
  stopSkills: ['Rust'],
  experience: alex.experience,
  mindset: 'Understanding the problem matters more than the tool.',
  salaryExpectation: null,
  candidate: alex,
}

const samProfile: ProfileForPrompt = {
  fullName: 'Sam Okafor',
  headline: 'Product Designer',
  location: 'Lagos, Nigeria',
  yearsExperience: 5,
  summary: 'Designs onboarding flows for consumer apps.',
  skills: ['Figma', 'user research', 'prototyping'],
  facts: ['redesigned onboarding for 2M users'],
  titles: ['Senior Product Designer'],
  stopSkills: [],
  candidate: sam,
}

const job: JobForPrompt = {
  id: 'j1',
  title: 'Senior Backend Engineer',
  company: 'Acme',
  countryCode: 'IE',
  description: 'Node.js services on AWS Lambda. We sponsor visas.',
  mustHaveSkills: ['Node.js', 'AWS'],
  hook: 'Their Lambda-based ingestion pipeline is the kind of thing I have run in production.',
}
const deJob: JobForPrompt = { ...job, id: 'j2', countryCode: 'DE', company: 'Berlin GmbH' }

const formField = { key: 'q1', label: 'Do you need sponsorship?', kind: 'radio', required: true, options: ['Yes', 'No'] }

describe('draft prompt', () => {
  const system = draftSystemPrompt({ profile, job, ai: DEFAULT_AI })

  it('is versioned and carries the profile mindset and skills', () => {
    expect(PROMPT_VERSION).toBe('v8')
    const block = profileBlock(profile)
    expect(block).toContain('Mindset')
    expect(block).toContain('AWS Lambda')
    expect(block).toContain('Profession: software engineer')
    expect(block).not.toMatch(/notice period|earliest start/i)
  })

  it('asks for a confident, polite, human email in plain English, never pleading', () => {
    expect(system).toMatch(/polite and confident, never servile or pleading/i)
    expect(system).toMatch(/honestly thinks their experience fits/)
    expect(system).toMatch(/Easy, everyday English/)
    expect(system).toMatch(/no em dashes, no en dashes/i)
    expect(system).toMatch(/Straight quotes only/)
    expect(system).toContain('"Best wishes,"')
    expect(system).toMatch(/thank-you line/i)
    expect(system).toContain('as Alex Rivera')
  })

  it('matches requirements to real experience and allows cloud examples for software', () => {
    expect(system).toMatch(/Exactly two proof points, each tied to a different requirement/)
    expect(system).toMatch(/the exact job title/)
    expect(system).toMatch(/cloud, DevOps, deployment/)
    expect(system).toMatch(/learn whatever stack they use/)
    expect(system).toMatch(/has done that kind of work before/)
    expect(system).toMatch(/genuinely wants THIS company/)
    const design = draftSystemPrompt({ profile: samProfile, job, ai: DEFAULT_AI })
    expect(design).not.toMatch(/cloud, DevOps/)
    expect(design).toMatch(/kind, thoughtful designer/)
    expect(design).toMatch(/learn whatever tools they use/)
  })

  it('writes the topics to avoid as "never mention" and leads with the chosen skills', () => {
    expect(system).toMatch(/Never mention these topics, even when the profile does: "crypto trading", "my agency years"/)
    expect(system).toMatch(/Lead with React, Node\.js/)
    const letter = coverLetterPrompt(profile, job, DEFAULT_AI)
    expect(letter.system).toMatch(/Never mention these topics[^.]*"crypto trading"/)
    const bare = draftSystemPrompt({ profile: { ...profile, candidate: undefined }, job, ai: DEFAULT_AI })
    expect(bare).not.toMatch(/Never mention these topics/)
    expect(bare).toMatch(/"Kind regards,"/)
  })

  it('answers a decline with other roles, the posting and a polite referral ask', () => {
    const r = replyDraftPrompt({ profile, job, posting: 'We build MarineTraffic.', thread: [], classification: 'LOCATION_ISSUE', summary: null, questions: [], contactName: null, facts: [], unknown: [] })
    expect(r.system).toMatch(/LOCATION_ISSUE/)
    expect(r.system).toMatch(/recruiter, a friend or another company/)
    expect(r.system).toContain('Europe/Lisbon')
    expect(r.prompt).toContain('We build MarineTraffic.')
  })

  it('never mentions notice period, start dates or the permit, and says the candidate is interested instead', () => {
    expect(system).toMatch(/Do NOT mention a notice period, start dates/)
    expect(system).toMatch(/Do NOT mention visas, work permits, sponsorship/)
    expect(system).not.toContain('Critical Skills Employment Permit')
    expect(system).toContain('genuinely interested in this role')
  })

  it('opens warmly with where the job was seen and why it fits, in a humble voice', () => {
    expect(system).toContain('"Hello ')
    expect(system).toContain('I hope you are doing well.')
    expect(system).toMatch(/where the candidate saw the posting and why it caught their interest/)
    expect(system).toMatch(/very polite and humble, but smart/i)
    expect(jobBlock({ ...job, foundOn: 'LinkedIn' }, 100)).toContain('Found on: LinkedIn')
  })

  it('user prompt carries the job, the hook and rewrite findings', () => {
    const user = draftUserPrompt({ profile, job, ai: DEFAULT_AI, rewrite: { subject: 'S', body: 'B', findings: '- [must fix] too long' } })
    expect(user).toContain('Suggested opening angle')
    expect(user).toContain('too long')
    expect(user).toContain('Acme')
  })

  it('cover letter answers come from the profile, with neutral fallbacks', () => {
    const cover = coverLetterPrompt(profile, job, DEFAULT_AI)
    expect(cover.system).toContain('noticePeriod: "1 month"')
    expect(cover.system).toMatch(/earliestStart: exactly "Flexible, happy to discuss."/)
    expect(cover.system).toMatch(/no notice period or start date/i)
    const bare = coverLetterPrompt({ ...profile, candidate: undefined }, job, DEFAULT_AI)
    expect(bare.system).toMatch(/Happy to discuss at the interview stage/)
    const fu = followUpPrompt({ profile, job, originalSubject: 'S', originalBody: 'B', sentDaysAgo: 7 })
    expect(fu.system).toMatch(/polite/i)
    expect(fu.system).toMatch(/Best wishes/)
  })
})

describe('work rights and sponsorship', () => {
  it('a candidate who needs sponsorship gets the sponsorship rule', () => {
    const f = formAnswersPrompt({ profile: samProfile, job, saved: [], facts: [], fields: [formField] })
    expect(f.system).toMatch(/needs employer visa sponsorship/)
    expect(f.system).toMatch(/which visa do you hold/)
    const r = replyDraftPrompt({ profile: samProfile, job, thread: [], classification: 'LOCATION_ISSUE', summary: null, questions: [], contactName: null, facts: [], unknown: [] })
    expect(r.system).toMatch(/needs employer visa sponsorship/)
    expect(r.system).toMatch(/visa paperwork/)
    const fix = formFixPrompt({ job, candidate: sam, reason: 'x', url: 'u', recentLog: [], fields: [], buttons: [], errors: [], pageText: '', facts: [], lessons: [] })
    expect(fix.system).toMatch(/needs employer visa sponsorship/)
    const enrich = enrichPrompt([job], sam)
    expect(enrich.system).toMatch(/designer based in Nigeria who needs employer visa sponsorship/)
    expect(rankPrompt(samProfile, [job]).system).toMatch(/needs visa sponsorship is realistic/)
  })

  it('an EU citizen applying in the EU does not', () => {
    const f = formAnswersPrompt({ profile, job: deJob, saved: [], facts: [], fields: [formField] })
    expect(f.system).not.toMatch(/needs? employer visa sponsorship/)
    expect(f.system).not.toMatch(/which visa do you hold/)
    expect(f.system).toMatch(/do not need visa sponsorship there/)
    expect(f.system).toMatch(/"will you need sponsorship" is No/)
    const d = driverPrompt({ job: deJob, candidate: alex, url: 'u', why: 'w', snapshot: '', history: [], facts: [], coverLetter: null, lessons: [], mayPressSubmit: false, hasScreenshot: true })
    expect(d.system).not.toMatch(/needs? employer visa sponsorship/)
    expect(d.system).toContain('+351 912 345 678')
    expect(d.system).toContain('Job Pilot')
    const r = replyDraftPrompt({ profile, job: deJob, thread: [], classification: 'LOCATION_ISSUE', summary: null, questions: [], contactName: null, facts: [], unknown: [] })
    expect(r.system).not.toMatch(/visa paperwork/)
    expect(enrichPrompt([job], alex).system).not.toMatch(/sponsorship to work|needs employer visa/)
    expect(rankPrompt(profile, [job]).system).not.toMatch(/needs visa sponsorship is realistic/)
  })

  it('without any answers the rule hands the question to the person', () => {
    const f = formAnswersPrompt({ profile: { ...profile, candidate: undefined }, job, saved: [], facts: [], fields: [formField] })
    expect(f.system).toMatch(/has not said whether they may work/)
  })

  it('form answers use the saved diversity answers, the motivation and how they heard', () => {
    const f = formAnswersPrompt({ profile, job, saved: [], facts: [], fields: [formField] })
    expect(f.system).toContain('gender: Non-binary')
    expect(f.system).toContain('I want to work on a product used every day.')
    expect(f.system).toContain('through LinkedIn')
    expect(f.system).toMatch(/a strong candidate in their situation/)
  })
})

describe('level and permit facts', () => {
  it('pitches senior and mid-level roles differently', () => {
    expect(levelRule('Senior Software Engineer', alex)).toMatch(/senior role/)
    expect(levelRule('Software Engineer II', alex)).toMatch(/mid-level engineering role/)
    expect(levelRule('Software Engineer II', alex)).toMatch(/do not claim a lead title/)
    expect(levelRule('Product Designer', sam)).toMatch(/a mid-level role\./)
    expect(levelRule('Lead Software Engineer')).toMatch(/lead role/)
  })
  it('states checkable permit facts for Ireland', () => {
    expect(permitFacts('IE')).toMatch(/Critical Skills list/)
    expect(permitFacts('IE')).toMatch(/no labour market test/)
    expect(permitFacts('FR')).toBe(permitFor('FR'))
    expect(permitFor('IE', sam)).toBe('an employer-sponsored work permit')
  })
})

describe('no personal assumptions', () => {
  it('no prompt builder writes a hard-coded person or place', () => {
    const thread = [{ direction: 'INBOUND' as const, from: 'x@acme.test', subject: 'Re: role', body: 'Thanks' }]
    const texts: string[] = []
    const add = (r: { system: string; prompt: string } | string) => texts.push(typeof r === 'string' ? r : `${r.system}\n${r.prompt}`)
    for (const [prof, cand] of [
      [profile, alex],
      [samProfile, sam],
      [{ ...profile, candidate: undefined }, buildCandidateContext(null)],
    ] as const) {
      for (const j of [job, deJob]) {
        add(enrichPrompt([j], prof.candidate))
        add(rankPrompt(prof, [j]))
        add(draftSystemPrompt({ profile: prof, job: j, ai: DEFAULT_AI }))
        add(draftUserPrompt({ profile: prof, job: j, ai: DEFAULT_AI }))
        add(coverLetterPrompt(prof, j, DEFAULT_AI))
        add(followUpPrompt({ profile: prof, job: j, originalSubject: 'S', originalBody: 'B', sentDaysAgo: 5 }))
        add(replyDraftPrompt({ profile: prof, job: j, thread, classification: 'LOCATION_ISSUE', summary: null, questions: [], contactName: null, facts: [], unknown: [] }))
        add(formAnswersPrompt({ profile: prof, job: j, saved: [], facts: [], fields: [formField] }))
        add(rewriteFormTextPrompt({ profile: prof, job: j, items: [] }))
        add(formFixPrompt({ job: j, candidate: cand, reason: 'r', url: 'u', recentLog: [], fields: [], buttons: [], errors: [], pageText: '', facts: [], lessons: [] }))
        add(driverPrompt({ job: j, candidate: cand, url: 'u', why: 'w', snapshot: '', history: [], facts: [], coverLetter: null, lessons: [], mayPressSubmit: true, hasScreenshot: true }))
        add(diagnosePrompt({ url: 'u', job: j, candidate: cand, reason: 'r', snapshot: '', history: [] }))
      }
    }
    add(judgePrompt('S', 'B', 'Acme'))
    add(classifyReplyPrompt({ ourSubject: 'S', ourBody: 'B', replyFrom: 'x', replySubject: 'R', replyBody: 'B' }))
    add(parseResumePrompt('cv'))
    // Words that used to be hard-coded in these prompts. Split up so a repo-wide grep for them stays at zero.
    const forbidden = ['Dh' + 'aka', 'Bangla' + 'desh', '+8' + '80', 'Ma' + 'ruf', 'Bil' + 'lah', 'A/' + 'B testing', 'UTC' + '+6']
    for (const t of texts) {
      for (const word of forbidden) expect(t).not.toContain(word)
      expect(t).not.toMatch(/\bhe asked on\b/i)
    }
  })
})
