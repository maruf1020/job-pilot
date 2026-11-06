import { describe, expect, it } from 'vitest'
import { buildCandidateContext } from '@/lib/candidate/context'
import { DEFAULT_SEARCH, type SearchConfig } from '@/lib/settings/schema'
import { fitsStack, looksLikeSoftwareRole, prefilterReason } from './prefilter'

const long = (s: string) => `${s} `.repeat(40)

const SOFTWARE: SearchConfig = { ...DEFAULT_SEARCH, profession: 'software', excludeTitleKeywords: ['junior', 'intern'] }
const DESIGN: SearchConfig = { ...DEFAULT_SEARCH, profession: 'design', targetTitles: ['Product Designer', 'UX Designer'] }

/** Fictional personas: Alex Rivera (Portuguese citizen, reads Portuguese) and Sam Okafor (needs sponsorship). */
const alex = buildCandidateContext({ fullName: 'Alex Rivera', country: 'PT', citizenships: ['PT'], workAuth: { needsSponsorship: false }, languageLevels: [{ name: 'English', level: 'fluent' }, { name: 'Portuguese', level: 'native' }] })
const sam = buildCandidateContext({ fullName: 'Sam Okafor', country: 'NG', citizenships: ['NG'], workAuth: { needsSponsorship: true }, languageLevels: [{ name: 'English', level: 'fluent' }] })

describe('prefilterReason', () => {
  it('keeps a plain software job in Europe', () => {
    const r = prefilterReason({ title: 'Senior Software Engineer', description: long('We build web apps in TypeScript and React.'), countryCode: 'NL' }, SOFTWARE)
    expect(r.reason).toBeNull()
    expect(r.language).toBe('eng')
  })

  it('drops excluded title keywords, other trades and roles outside the field', () => {
    expect(prefilterReason({ title: 'Junior Developer', description: '', countryCode: 'NL' }, SOFTWARE).reason).toMatch(/junior/)
    expect(prefilterReason({ title: 'Launcher Propulsion Engineer', description: long('Rockets and turbopumps.'), countryCode: 'DE' }, SOFTWARE).reason).toMatch(/propulsion/)
    expect(prefilterReason({ title: 'Head of Marketing', description: long('Campaigns and brand.'), countryCode: 'DE' }, SOFTWARE).reason).toBe('Not a software engineering role')
  })

  it('keeps design jobs for a designer and drops developer jobs', () => {
    expect(prefilterReason({ title: 'Senior Product Designer', description: long('Figma and user research.'), countryCode: 'PT' }, DESIGN).reason).toBeNull()
    expect(prefilterReason({ title: 'Interior Designer', description: long('Retail spaces.'), countryCode: 'PT' }, DESIGN).reason).toMatch(/interior/)
    expect(prefilterReason({ title: 'Backend Engineer', description: long('Go services and Kafka.'), countryCode: 'PT' }, DESIGN).reason).toBe('Not a design role')
    // A vague title passes when the description is about design work.
    expect(prefilterReason({ title: 'Creative Lead', description: long('Wireframes, prototyping in Figma and usability tests.'), countryCode: 'PT' }, DESIGN).reason).toBeNull()
  })

  it('lets every field through for the open "other" profession', () => {
    expect(prefilterReason({ title: 'Head of Marketing', description: '', countryCode: 'DE' }, DEFAULT_SEARCH).reason).toBeNull()
  })

  it('drops by place and remote settings', () => {
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: 'US' }, SOFTWARE).reason).toMatch(/Outside Europe/)
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: 'GB' }, { ...SOFTWARE, includeUk: false }).reason).toMatch(/UK/)
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: null, remote: true }, { ...SOFTWARE, includeRemote: false }).reason).toMatch(/Remote/)
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: 'NL', remote: false }, { ...SOFTWARE, remoteOnly: true }).reason).toMatch(/remote-only/)
    expect(prefilterReason({ title: 'Software Engineer', description: '', location: 'Remote - Kenya' }, SOFTWARE).reason).toMatch(/Outside Europe \(Kenya\)/)
  })

  it('drops postings in a language the person does not read', () => {
    const de = 'Wir suchen einen erfahrenen Softwareentwickler für unser Team in Berlin. Sie arbeiten mit modernen Technologien und entwickeln Webanwendungen. '.repeat(5)
    expect(prefilterReason({ title: 'Softwareentwickler', description: de, countryCode: 'DE' }, SOFTWARE).reason).toMatch(/not in English/)
    const pt = 'Procuramos um engenheiro de software experiente para a nossa equipa em Lisboa. Vai trabalhar com tecnologias modernas e desenvolver aplicações web para os nossos clientes. '.repeat(5)
    expect(prefilterReason({ title: 'Engenheiro de Software', description: pt, countryCode: 'PT' }, SOFTWARE, alex).reason).toBeNull()
    expect(prefilterReason({ title: 'Engenheiro de Software', description: pt, countryCode: 'PT' }, SOFTWARE, sam).reason).toMatch(/not in English/)
  })

  it('applies the visa rules only for a person who needs a visa there', () => {
    const noVisa = long('We build web apps in TypeScript. We do not sponsor work permits.')
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: 'NL', visaFlag: false }, SOFTWARE).reason).toMatch(/no visa/)
    expect(prefilterReason({ title: 'Software Engineer', description: noVisa, countryCode: 'NL' }, SOFTWARE, sam).reason).toMatch(/no visa sponsorship/)
    expect(prefilterReason({ title: 'Software Engineer', description: noVisa, countryCode: 'NL' }, SOFTWARE, alex).reason).toBeNull()
    expect(prefilterReason({ title: 'Software Engineer', description: '', countryCode: 'NL', visaFlag: false }, SOFTWARE, alex).reason).toBeNull()
  })
})

describe('looksLikeSoftwareRole', () => {
  it('matches on title or description', () => {
    expect(looksLikeSoftwareRole('Frontend Developer', '')).toBe(true)
    expect(looksLikeSoftwareRole('Technical Lead', 'You will own our React and Node.js platform')).toBe(true)
    expect(looksLikeSoftwareRole('Office Manager', 'Ordering supplies and greeting visitors')).toBe(false)
  })
})

describe('fitsStack', () => {
  it('works for any stack, not one language family', () => {
    const java = ['java', 'spring', 'kotlin']
    expect(fitsStack('Backend Engineer', 'Java 21 and Spring Boot; some React on the admin side.', java)).toBe(true)
    expect(fitsStack('Backend Engineer', 'TypeScript, React and Node.js; a little Java.', java)).toBe(false)
    expect(fitsStack('Product Designer', 'Figma and prototyping.', ['figma'])).toBe(true)
  })
})
