import { buildCandidateContext, type CandidateContext } from '@/lib/candidate/context'

/** Fictional people for tests. Alex Rivera: an EU (Portuguese) citizen in Lisbon, they/them. */
export const ALEX_PROFILE = {
  fullName: 'Alex Rivera',
  givenName: 'Alex',
  familyName: 'Rivera',
  pronouns: 'they/them',
  email: 'alex.rivera@example.com',
  phoneCountryCode: '+351',
  phone: '912 345 678',
  addressLine: 'Rua Exemplo 12',
  postalCode: '1000-001',
  city: 'Lisbon',
  region: 'Lisbon',
  country: 'PT',
  timezone: 'Europe/Lisbon',
  citizenships: ['PT'],
  links: { linkedin: 'https://www.linkedin.com/in/alex-rivera-example', github: 'https://github.com/alex-rivera-example', portfolio: 'https://alexrivera.example.com' },
  headline: 'Senior Software Engineer',
  profession: 'software',
  yearsExperience: 7,
  skills: ['TypeScript', 'React', 'Node.js'],
  experience: [
    { company: 'Northwind Labs', title: 'Senior Software Engineer', from: '2021', to: null },
    { company: 'Contoso Digital', title: 'Software Engineer', from: '2018', to: '2021' },
  ],
  education: [{ school: 'University of Lisbon', degree: 'BSc Computer Science', year: '2018' }],
  workAuth: { needsSponsorship: true, rightToWork: [], authorizationText: null },
  relocation: 'yes',
  remote: 'ok',
  languageLevels: [
    { name: 'English', level: 'fluent' },
    { name: 'Portuguese', level: 'native' },
  ],
  degree: 'BSc Computer Science',
  diversity: { gender: 'Non-binary', veteran: 'No' },
  noticePeriod: '2 months',
  howHeard: 'LinkedIn',
}

/** Sam Okafor: a Nigerian citizen in Lagos who needs visa sponsorship in Europe, he/him. */
export const SAM_PROFILE = {
  fullName: 'Sam Okafor',
  givenName: 'Sam',
  familyName: 'Okafor',
  pronouns: 'he/him',
  email: 'sam.okafor@example.com',
  phoneCountryCode: '+234',
  phone: '802 000 0000',
  city: 'Lagos',
  country: 'NG',
  citizenships: ['NG'],
  workAuth: { needsSponsorship: true, rightToWork: [], authorizationText: null },
  relocation: 'yes',
  remote: 'only',
}

export const alex = (over: Record<string, unknown> = {}): CandidateContext => buildCandidateContext({ ...ALEX_PROFILE, ...over }, 'Europe/Lisbon')
export const sam = (over: Record<string, unknown> = {}): CandidateContext => buildCandidateContext({ ...SAM_PROFILE, ...over }, 'Africa/Lagos')
