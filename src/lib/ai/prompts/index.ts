import { DEFAULT_BANNED_PHRASES } from '@/lib/pipeline/humanize/banned-phrases'
import type { AiConfig } from '@/lib/settings/schema'
import { truncate } from '@/lib/text'
import { countryNameOf, needsSponsorshipFor, workRightsSentence, type CandidateContext, type Diversity } from '@/lib/candidate/context'

export const PROMPT_VERSION = 'v8'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export interface ProfileForPrompt {
  fullName: string
  headline: string
  location: string
  yearsExperience: number
  summary: string
  skills: string[]
  facts: string[]
  titles: string[]
  stopSkills: string[]
  experience?: Array<{ company: string; title: string; from?: string | null; to?: string | null; bullets?: string[] }>
  /** How the candidate thinks about the work; used at most once per email, humbly. */
  mindset?: string | null
  salaryExpectation?: string | null
  /**
   * Everything else about the person (name parts, pronouns, location, work rights, languages,
   * email voice...). Optional so tests can pass a bare profile; prompts fall back to neutral text.
   */
  candidate?: CandidateContext
}

export interface JobForPrompt {
  id: string
  title: string
  company: string
  location?: string | null
  countryCode?: string | null
  url?: string
  description: string
  summary?: string | null
  mustHaveSkills?: string[]
  sponsorship?: string
  sponsorshipEvidence?: string[]
  hook?: string | null
  contactName?: string | null
  /** Where the candidate saw the posting, in words for the reader ("LinkedIn", "your careers page"). */
  foundOn?: string | null
}

/**
 * The words prompts use for the person: name, pronouns, profession noun, sign-off. Everything falls
 * back to neutral wording ("the candidate", they/them) when the profile has no answer yet.
 */
interface Persona {
  c?: CandidateContext
  name: string
  he: string
  him: string
  his: string
  self: string
  noun: string
  signOff: string
  software: boolean
}

function persona(c?: CandidateContext, fullName?: string | null): Persona {
  const he = c?.he ?? 'they'
  return {
    c,
    name: (fullName ?? '').trim() || c?.fullName || 'the candidate',
    he,
    him: c?.him ?? 'them',
    his: c?.his ?? 'their',
    self: he === 'he' ? 'himself' : he === 'she' ? 'herself' : 'themselves',
    noun: c?.professionNoun || 'professional',
    signOff: c?.voice.signOff || 'Kind regards,',
    software: c?.profession === 'software',
  }
}

const quoteList = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ')

export function profileBlock(p: ProfileForPrompt): string {
  const exp = (p.experience ?? [])
    .slice(0, 4)
    .map((e) => `- ${e.title} at ${e.company}${e.from ? ` (${e.from} to ${e.to ?? 'present'})` : ''}${e.bullets?.length ? `: ${e.bullets.slice(0, 3).join('; ')}` : ''}`)
    .join('\n')
  return [
    `Name: ${p.fullName}`,
    `Current role: ${p.headline}`,
    p.candidate ? `Profession: ${p.candidate.professionNoun}` : '',
    `Based in: ${p.location}`,
    `Experience: ${p.yearsExperience} years`,
    `Summary: ${p.summary}`,
    `Skills: ${p.skills.join(', ')}`,
    `Quotable facts: ${p.facts.map((f) => `"${f}"`).join(', ')}`,
    exp ? `Experience:\n${exp}` : '',
    p.mindset ? `Mindset (the candidate's own words: reuse their spirit once, in fresh words; never paste them): ${p.mindset}` : '',
    p.stopSkills.length ? `Never claim these skills: ${p.stopSkills.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function jobBlock(j: JobForPrompt, descriptionChars: number): string {
  return [
    `### id: ${j.id}`,
    `Title: ${j.title}`,
    `Company: ${j.company}`,
    j.location ? `Location: ${j.location}${j.countryCode ? ` (${j.countryCode})` : ''}` : '',
    j.url ? `URL: ${j.url}` : '',
    j.foundOn ? `Found on: ${j.foundOn}` : '',
    j.summary ? `Summary: ${j.summary}` : '',
    j.mustHaveSkills?.length ? `Key skills: ${j.mustHaveSkills.join(', ')}` : '',
    j.sponsorship ? `Sponsorship: ${j.sponsorship}${j.sponsorshipEvidence?.length ? ` (${j.sponsorshipEvidence.join(' | ')})` : ''}` : '',
    `Description:\n${truncate(j.description, descriptionChars)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function spellingFor(countryCode?: string | null): 'British' | 'American' {
  const c = (countryCode ?? '').toUpperCase()
  return c === 'US' || c === 'CA' ? 'American' : 'British'
}

/** Ireland's Critical Skills list covers ICT and data roles; other roles use the general permit wording. */
function onIrishCriticalSkillsList(c?: CandidateContext): boolean {
  return !c || c.profession === 'software' || c.profession === 'data'
}

export function permitFor(countryCode?: string | null, c?: CandidateContext): string {
  return (countryCode ?? '').toUpperCase() === 'IE' && onIrishCriticalSkillsList(c) ? 'a Critical Skills Employment Permit' : 'an employer-sponsored work permit'
}

/** Neutral names for the job country in prompts. */
function whereOf(countryCode?: string | null): string {
  return countryNameOf(countryCode) ?? "the job's country"
}

/**
 * The right-to-work rule for one job country, from the person's citizenship and answers. Spells out
 * the answers to the usual sponsorship questions so a form is never filled with a permit the person
 * does not have, and only talks about sponsorship when it applies.
 */
function workRightsRule(p: Persona, countryCode?: string | null): string {
  const where = whereOf(countryCode)
  if (!p.c) return `The candidate has not said whether they may work in ${where} without sponsorship: work-authorisation questions need the candidate (needs human). Never claim a citizenship, residence or permit.`
  const need = needsSponsorshipFor(p.c, countryCode)
  const parts = [p.c.workAuth.authorizationText ? `In ${p.his} own words: ${p.c.workAuth.authorizationText}.` : '', workRightsSentence(p.c, countryCode)]
  if (need === true)
    parts.push(
      `The permit route would be ${permitFor(countryCode, p.c)}. The candidate holds no visa, residence permit or settled status for ${where}: never pick an option whose label says citizen, national or resident there or a visa held there (even an "N/A - I am a citizen" option); for "which visa do you hold" pick none / not applicable / other, whichever comes closest to "no visa yet".`,
    )
  if (need === false) parts.push('So "authorised / legally allowed to work" is Yes and "will you need sponsorship" is No.')
  parts.push('Never claim a citizenship, residence or permit the facts do not show.')
  return parts.filter(Boolean).join(' ')
}

/** Relocation and remote preferences as one sentence, or '' when the person has not said. */
function movePrefs(p: Persona): string {
  const bits: string[] = []
  const r = p.c?.relocation
  if (r === 'yes') bits.push('is willing to relocate')
  if (r === 'maybe') bits.push('is open to relocating')
  if (r === 'no') bits.push('is not looking to relocate')
  const w = p.c?.remote
  if (w === 'only') bits.push('is looking for remote roles only')
  if (w === 'ok') bits.push('is happy to work remotely, on site or hybrid')
  if (w === 'no') bits.push('prefers on-site or hybrid work')
  return bits.length ? `The candidate ${bits.join(' and ')}.` : ''
}

/** Topics the person never wants in an application, and what to lead with instead. */
function voiceRule(p: Persona): string {
  const never = p.c?.voice.neverMention ?? []
  const lead = p.c?.voice.leadWith ?? []
  return [
    never.length ? `Never mention these topics, even when the profile does: ${quoteList(never)}.` : '',
    lead.length ? `Lead with ${lead.join(', ')} and the work from the profile that this posting asks for.` : 'Lead with the skills and work from the profile that this posting asks for.',
  ]
    .filter(Boolean)
    .join(' ')
}

const BANNED_FOR_PROMPT = DEFAULT_BANNED_PHRASES.filter((p) => !p.isRegex && p.severity === 'error')
  .map((p) => p.phrase)
  .slice(0, 60)

/** Style rules shared by every piece of writing that goes to an employer. */
export const HUMAN_STYLE = `Easy, everyday English that a real person would type. Short sentences most of the time, one longer one now and then. Contractions are fine (I'm, I've, that's). Commas and full stops do the work: no em dashes, no en dashes, no semicolons, no exclamation marks, no ellipsis. A normal hyphen is only for joined words such as "front-end". Straight quotes only (' and "). Polite and confident, never servile or pleading: "please" and "thank you" are welcome; "kindly", "esteemed", "humbly", "I would be grateful for the chance", "I hope you will consider me" and "give me an opportunity" are not. Write as a peer offering to solve their problem, not as someone asking for a favour.`

// ---------------------------------------------------------------------------
// Enrich (lite model, batched)
// ---------------------------------------------------------------------------

export function enrichPrompt(jobs: JobForPrompt[], candidate?: CandidateContext): { system: string; prompt: string } {
  const p = persona(candidate)
  const lives = candidate?.countryName ? ` based in ${candidate.countryName}` : ''
  const sponsor = candidate?.workAuth.needsSponsorship === true ? ' who needs employer visa sponsorship in countries where they have no right to work' : ''
  return {
    system: `You extract structured facts from job postings for a ${p.noun}${lives}${sponsor}.
Answer ONLY with JSON matching the schema. One item per job, same ids as the input, no extra items.

Rules:
- sponsorship: "yes" only when the posting explicitly says it sponsors visas / work permits / relocates international hires. "no" only when it explicitly requires an existing right to work, EU citizenship, or says no sponsorship. "likely" when there are strong signals (relocation package, "we hire from anywhere in the world", "international team from 30 countries", "visa support"). "unknown" otherwise. Be conservative.
- sponsorshipEvidence: up to 4 short verbatim quotes that support the verdict. Empty if unknown.
- requiredLanguages: only human languages the role REQUIRES besides English (e.g. "German"). Ignore "nice to have". Empty if English only or not stated.
- mustHaveSkills: hard requirements (tools, technologies, methods) as short tokens, for any kind of role ("React", "PostgreSQL", "Figma", "SQL", "Salesforce", "user research", "financial modelling"). Max 10.
- niceToHaveSkills: optional ones, max 10.
- seniority: junior | mid | senior | lead | staff | manager | unknown, from the title and years asked.
- salaryEurMin: annual minimum converted to EUR when a salary is stated, else null. Monthly figures x12.
- contactEmail: an email address the posting says to apply to or contact. Otherwise null. Never invent one.
- applyChannel: "email" if applications go by email, "ats" if there is an application form or ATS (Greenhouse, Lever, Workday, Ashby, Workable, SmartRecruiters, Personio, Teamtailor), "portal" if a company careers page, "unknown" otherwise.
- relocationSupport: true if relocation help is offered, false if explicitly not, null if not stated.
- summary: two plain sentences, what the team does and what this role does. No marketing language.`,
    prompt: `Jobs:\n\n${jobs.map((j) => jobBlock(j, 4000)).join('\n\n---\n\n')}`,
  }
}

// ---------------------------------------------------------------------------
// Rank (primary model, batched)
// ---------------------------------------------------------------------------

/** What the rank prompt weighs about the person: level, skills and (only when it applies) sponsorship. */
function rankConsiderations(profile: ProfileForPrompt, p: Persona): string {
  const c = p.c
  const years = profile.yearsExperience || c?.yearsExperience || 0
  const seniority = c?.seniority.length ? c.seniority.join(' / ') : null
  const level = years
    ? `title and seniority fit (the candidate has about ${years} years of experience${seniority ? ` and targets ${seniority} roles` : ''}, so roles clearly below or above that level score low)`
    : `title and seniority fit${seniority ? ` (the candidate targets ${seniority} roles)` : ''}`
  const parts = [level, "overlap between the posting's required skills, tools and methods and the candidate's skills"]
  if (p.software) parts.push("cloud and infrastructure requirements against the cloud experience in the candidate's profile")
  parts.push('product domain', 'human-language requirements')
  if (c?.workAuth.needsSponsorship === true) {
    const rights = [...c.citizenshipNames, ...c.workAuth.rightToWork.map((x) => countryNameOf(x) ?? x)]
    parts.push(
      `whether hiring someone who needs visa sponsorship is realistic for this employer when the job is in a country where the candidate has no right to work${rights.length ? ` (the candidate may already work in: ${rights.join(', ')}${c.citizenships.length ? ', plus the EU/EEA free-movement area when a citizenship is in it' : ''})` : ''}`,
    )
  }
  return parts.join(', ')
}

export function rankPrompt(profile: ProfileForPrompt, jobs: JobForPrompt[]): { system: string; prompt: string } {
  const p = persona(profile.candidate, profile.fullName)
  return {
    system: `You are a blunt, experienced recruiter who hires ${p.noun}s. Score how well the candidate fits EACH job from 0 to 100.
90+ = obvious shortlist. 70-89 = solid match. 50-69 = partial match. Under 50 = weak or wrong level.

Consider: ${rankConsiderations(profile, p)}. A tool or method the candidate has not used is a small gap, not a blocker, when the rest of the requirements overlap.
reasons and gaps: concrete, plain words, no buzzwords. Max 5 each.
oneLineHook: ONE specific sentence that links the candidate to THIS role or company and could open an email. It must reference something concrete from the posting (a product, a tool or method choice, a problem they describe). No praise, no buzzwords, no exclamation marks, no dashes, under 30 words.
Answer ONLY with JSON matching the schema, one item per job, same ids.`,
    prompt: `Candidate profile:\n${profileBlock(profile)}\n\nJobs:\n\n${jobs.map((j) => jobBlock(j, 2500)).join('\n\n---\n\n')}`,
  }
}

// ---------------------------------------------------------------------------
// Draft / rewrite (primary model)
// ---------------------------------------------------------------------------

export interface DraftInput {
  profile: ProfileForPrompt
  job: JobForPrompt
  ai: AiConfig
  extraNote?: string | null
  /** Previous draft + findings, for a rewrite round. */
  rewrite?: { subject: string; body: string; findings: string }
}

function tones(p: Persona): Record<AiConfig['tone'], string> {
  return {
    direct: `calm and clear, like a thoughtful, experienced ${p.noun} writing to a peer. Polite, never salesy.`,
    warm: 'warm, polite and humble, the way a kind, capable person writes to someone they respect. One human touch, no gushing, no pleading.',
    formal: 'polite and formal without being stiff. No slang, still plain words.',
  }
}

/** The candidate's voice: someone who can learn any tool, believes in their work, and really wants this company. */
function confidenceRule(p: Persona): string {
  return `In the candidate's own voice, one or two sentences that show the candidate did ${p.his} homework: ${p.he} looked at what this team is building and the problem behind the posting, and the candidate has done that kind of work before, backed by one concrete example from the profile. Said humbly ("I think my work on X could help here"), never a generic "I am the perfect candidate". The candidate is happy to learn whatever ${p.software ? 'stack' : 'tools'} they use.`
}

function companyLoveRule(_p?: Persona): string {
  return `Show that the candidate genuinely wants THIS company: one or two sentences built on one checkable fact from the posting (their product, customers, market, team or tools) and how it connects to work the candidate has done. Sincere and warm, always polite, never gushing ("excited", "thrilled", "dream company" are out). If the posting gives no such fact, leave the sentence out rather than praise. Never invent facts about the company.`
}

/**
 * What recruiters reply to (research brief: LeadDev, IEEE-USA, Greenhouse, Jobscan, Pangram): the posting's
 * exact title and one proof up front, two proofs tied to the posting's requirements, nothing a hundred other
 * letters say. Openings read like a person: where the job was seen, why it caught the eye, two or three
 * matching skills, instead of "Having built X, I can immediately contribute".
 */
function openingRule(p: Persona, profile: ProfileForPrompt): string {
  const skills = profile.skills.slice(0, 3)
  const skillText = skills.length >= 2 ? `${skills.slice(0, -1).join(', ')} and ${skills[skills.length - 1]}` : skills[0] ?? '<two or three matching skills>'
  const title = profile.titles[0] ?? profile.candidate?.titles[0] ?? '<job title>'
  return `The opening says simply where the candidate saw the posting and why it caught ${p.his} interest, then why ${p.he} ${p.he === 'they' ? 'think' : 'thinks'} it fits, for example: "I saw your ${title} role on LinkedIn and it caught my interest, because you are rebuilding the checkout for your marketplace. With my experience in ${skillText}, I think it could be a good match." Use the exact job title, the place from "Found on" in the job (leave the place out when there is none), one real detail from the posting, and two or three of the candidate's skills that the posting also asks for. Plain, natural words, the way a person talks. Never open with a claim about what the candidate will contribute or with "Having built/redesigned...", and never "I am writing to", "Please accept this application", "My name is", "I came across", "I am excited/thrilled to apply".`
}

function humbleRule(p: Persona): string {
  return `Voice: very polite and humble, but smart. The candidate sounds like a kind, thoughtful ${p.noun} who read the posting properly and honestly thinks ${p.his} experience fits: "I think", "I believe my work on X could help with Y", "I would be glad to". Smart means specific: real details from the posting and real work from the profile, never big claims. Never "I can immediately contribute", "I am a strong fit", "I can own", "the ideal candidate", and never pleading or begging.`
}

/** A plain, warm close; the stock ones are on the banned list and fail the linter. */
const CLOSING_RULE =
  'Close with one polite, low-pressure line (if they think it could be a fit, the candidate would be glad to have a short call whenever it suits them) and a simple thank-you such as "Thank you for reading." Never "Thank you for your time and consideration", "I look forward to hearing from you" or any line that begs for a chance.'

function proofRule(p: Persona): string {
  return `Exactly two proof points, each tied to a different requirement in the posting. Each says what the candidate built, delivered or owned, with a scale or a number taken from the profile, and spells tools and technologies the way the posting spells them (only ones that are in both the profile and the posting). Do not restate the CV: add what a CV cannot show, such as why ${p.he} made a decision or the trade-off ${p.he} chose. Never invent a number.`
}

const NOT_GENERIC =
  'At least two details must be specific to this posting or company, so the text could not be sent to another employer. Avoid lists of three (the two or three skills in the opening are the one exception), "not only... but also", "it is not X, it is Y", "In today\'s...", "I would welcome the opportunity", "I believe I would be a great fit", "align perfectly", "your esteemed company", "I am writing to express".'

/** How seniority shows in a short text: ownership and trade-offs for senior roles, solid delivery for mid-level ones. */
export function levelRule(title: string, candidate?: CandidateContext): string {
  const t = title.toLowerCase()
  const p = persona(candidate)
  if (/\b(lead|staff|principal|head|architect|manager)\b/.test(t))
    return `Level: a lead role. Show ${p.software ? 'technical ' : ''}leadership with evidence: ${p.software ? 'a design' : 'a decision'} the candidate owned, the team the candidate leads, how the candidate reviews work and mentors people.`
  if (/\b(senior|sr\.?)\b/.test(t))
    return `Level: a senior role. Show that the candidate owned an unclear problem end to end, one decision with the trade-off ${p.he} chose, and that the candidate reviews or mentors others. Impact beyond ${p.his} own tasks.`
  if (p.software)
    return `Level: a mid-level engineering role (Software Engineer, I/II/III). Show that the candidate ships well-scoped features on ${p.his} own, keeps quality high with tests and code review, and learns a new codebase fast. Do not oversell leadership and do not claim a lead title in the opening.`
  return `Level: a mid-level role. Show that the candidate delivers well-scoped work on ${p.his} own, keeps quality high, and learns a new team's tools and ways of working fast. Do not oversell leadership and do not claim a lead title in the opening.`
}

/** The permit, in facts an employer can check. Only used when the candidate needs sponsorship there. */
export function permitFacts(countryCode?: string | null, candidate?: CandidateContext): string {
  const c = (countryCode ?? '').toUpperCase()
  if (c === 'IE' && onIrishCriticalSkillsList(candidate))
    return "Ireland's Critical Skills Employment Permit; ICT roles are on the Critical Skills list, so there is no labour market test, and the application can be filed once there is an offer"
  if (c === 'DE' && (!candidate || candidate.profession === 'software')) return 'an EU Blue Card, which IT specialists qualify for at the lower salary threshold'
  if (c === 'NL') return 'a highly skilled migrant permit, which a recognised sponsor files in a few weeks'
  return permitFor(countryCode, candidate)
}

export function draftSystemPrompt(input: DraftInput): string {
  const { profile, job, ai } = input
  const p = persona(profile.candidate, profile.fullName)
  // Warm, not stiff: "Hello Marta," and a first line wishing them well.
  const greeting = `"Hello ${job.contactName ? job.contactName.split(' ')[0] : `${job.company} team`}," on its own line, and the first paragraph starts with "I hope you are doing well." before the opening`
  const cloudProof = p.software ? ' When the posting asks for cloud, DevOps, deployment or monitoring work and the profile shows that kind of experience, one of the two proofs can be that.' : ''
  return `You write job application emails as ${p.name}, ${profile.headline}, in the first person. The reader is a busy person at ${job.company} who receives many applications. Write like a real person: a kind, thoughtful ${p.noun} who read this posting properly, honestly thinks ${p.his} experience fits, and respects the reader's time. Very polite and humble, but smart and specific. Never a marketer, never an assistant, never a template, never pleading. The whole email must read as if the candidate typed it ${p.self}.

HARD RULES (a violation gets the email rejected):
1. Plain text. A greeting line, then 3 or 4 short paragraphs separated by blank lines (the polite ask and the thank-you belong in the last one), then "${p.signOff}" and the name on its own line. Count the paragraphs before you answer: more than 4 between the greeting and the sign-off is a rejection. No bullet points, numbered lists, headers, bold, emoji or links.
2. Body between ${ai.targetWords.min} and ${ai.targetWords.max} words. Subject under 60 characters, names the role and, when it fits, the company. It never starts with "Application for" or "Re:".
3. ${HUMAN_STYLE}
4. Opening: ${openingRule(p, profile)} ${humbleRule(p)}
5. Fit: ${proofRule(p)} Apart from the skills in the opening, do not list skills. Use at most four tool or technology names in the whole email.${cloudProof} By the end of this part the reader should think "this person has already done the work we need": show it through evidence, said humbly, never through claims like "I am the best fit" or "I am the ideal candidate". ${levelRule(job.title, p.c)}
6. Exactly one quotable fact taken from the "Facts" list in the profile, keeping its numbers and names exactly as written there (reworded around it is fine). An email without one of those facts is rejected.
7. Confidence and interest: ${confidenceRule(p)} ${companyLoveRule(p)}
8. Interest, not paperwork: near the end, one sincere sentence that the candidate is genuinely interested in this role at ${job.company}. Do NOT mention visas, work permits, sponsorship, relocation or where the candidate lives (it reads as a hurdle in a first email), and never imply anything about the right to work there. Do NOT mention a notice period, start dates, leaving the current employer, or how soon they could join.
9. Ending: one polite, humble, low-pressure ask (if they think it could be a fit, the candidate would be glad to have a short call whenever it suits them) and one warm thank-you line, for example "Thank you for taking the time to read this." Do not use "I look forward to hearing from you" or "Thank you for your time and consideration".
10. Never claim a skill that is not in the profile. Never invent facts about the company, or hobbies, interests and personal stories about the candidate (none are in the profile). Write in the first person: "I lead", never "${p.he} ${p.he === 'they' ? 'lead' : 'leads'}". If you do not know something, leave it out.
11. Vary sentence length on purpose. One small, natural opinion or preference is good. Every sentence should sound like something a person would say out loud.
12. Do not use any of these words or phrases: ${BANNED_FOR_PROMPT.join('; ')}. Also avoid: passionate, leverage, impactful, journey, align, dynamic, innovative, robust, seamless, utilize, cutting-edge, "I am confident that", "perfect fit", "hit the ground running", "reach out".
13. Greeting: ${greeting}. Spelling: ${spellingFor(job.countryCode)} English. Tone: ${tones(p)[ai.tone]}
14. The reader should not be able to tell an AI helped: no symmetry, no summary sentence at the end, no restating the job ad back to them.
15. ${voiceRule(p)}
16. ${NOT_GENERIC}

Output ONLY JSON: {"subject": "...", "body": "..."}. The body includes the greeting line and the sign-off lines.`
}

export function draftUserPrompt(input: DraftInput): string {
  const { profile, job } = input
  const parts = [
    `Candidate profile:\n${profileBlock(profile)}`,
    `Job:\n${jobBlock(job, 1800)}`,
    job.hook ? `Suggested opening angle (rewrite in your own words, do not copy): ${job.hook}` : '',
    input.extraNote ? `Extra instruction from the candidate: ${input.extraNote}` : '',
  ]
  if (input.rewrite) {
    parts.push(
      `A previous draft was reviewed and rejected. Rewrite it so that EVERY finding below is fixed. Keep what already works, change the rest. Do not mention the review.\n\nFindings:\n${input.rewrite.findings}\n\nPrevious subject: ${input.rewrite.subject}\nPrevious body:\n${input.rewrite.body}`,
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------------
// Judge (primary model, low temperature)
// ---------------------------------------------------------------------------

export function judgePrompt(subject: string, body: string, company: string): { system: string; prompt: string } {
  return {
    system: `You are a hiring manager at ${company} who receives many job application emails. You have learned to spot the ones produced by an AI assistant or a template, and you delete those without reading to the end.

Read the email below and estimate how likely it is machine-generated, from 0 (certainly written by a person) to 100 (certainly machine-generated).

Signals of machine text: generic praise of the company, buzzwords, every sentence the same length and shape, transitions like "Additionally" or "Furthermore", restating the job ad, no concrete detail, over-polished tone, list-like structure, flattery, "I am confident that", "align", "passionate", a tidy summary sentence at the end, perfect symmetry, no opinion.
Signals of a person: specific details that only this candidate could know, uneven rhythm, a small opinion or preference, concrete numbers, a direct ask, slightly informal phrasing, one imperfect but natural sentence. Politeness, humility and a simple thank-you line are normal for a real applicant and are not signs of AI on their own.

Quote the exact phrases that give it away in "tells". Give specific, actionable edits in "suggestions". Answer ONLY with JSON.`,
    prompt: `Subject: ${subject}\n\n${body}`,
  }
}

// ---------------------------------------------------------------------------
// Reply classification (lite model)
// ---------------------------------------------------------------------------

export function classifyReplyPrompt(input: { ourSubject: string; ourBody: string; replyFrom: string; replySubject: string; replyBody: string }): { system: string; prompt: string } {
  return {
    system: `Classify a reply to a job application email.
INTERVIEW_REQUEST = they propose a call, screening or interview, or ask for availability.
POSITIVE = a person is interested or hands the application to a colleague (a recruiter is now in the thread), wants to continue, asks for next steps, but no interview yet.
NEEDS_INFO = they ask for documents or answers (CV, portfolio, salary expectation, visa status, notice period, right to work) and the email channel stays open.
APPLY_VIA_PORTAL = they say applications by email are not accepted and point to a careers page, job board or application form; the candidate must apply there.
WRONG_RECIPIENT = the mailbox is for something else (customer support, billing, press, a job board, accommodations) and the application did not reach recruiting.
LOCATION_ISSUE = not a flat no: the obstacle is where the candidate lives, relocation, time zone, right to work or visa sponsorship ("we can only hire people based in X", "we cannot sponsor at the moment", "this role must be local"), with no complaint about the candidate's skills. Worth a polite reply asking about other roles.
REJECTION = not moving forward for other reasons, or the position is filled.
AUTO_REPLY = out-of-office, automatic acknowledgement, ticket created, with no instruction to apply elsewhere. Also automated system notices that are not about moving the application on: data retention, GDPR or privacy consent ("your data will be removed after 30 days unless you grant an extension"), account or password emails, and voluntary self-identification / EEO / diversity surveys ("for government reporting purposes ... completion is entirely voluntary"). These are never NEEDS_INFO, even when they ask you to click a link.
BOUNCE = delivery failure or mailbox not found.
OTHER = anything else (unrelated).
Also extract: applyUrl = the exact link they ask the candidate to use (null if none); contact = a named person who now handles it (handed over, copied in, or who signed a personal reply), with email if visible, else null; questions = each thing they ask the candidate to send or answer (empty if none); proposedTimes = any dates/times, verbatim; summary = one or two plain sentences; suggestedNextAction = what the candidate should do next, or null. Answer ONLY with JSON.`,
    prompt: `Our email:\nSubject: ${input.ourSubject}\n${truncate(input.ourBody, 1500)}\n\nReply from: ${input.replyFrom}\nSubject: ${input.replySubject}\n\n${truncate(input.replyBody, 4000)}`,
  }
}

// ---------------------------------------------------------------------------
// Reply to a recruiter (primary model): written for the candidate to review and send
// ---------------------------------------------------------------------------

export interface ReplyDraftInput {
  profile: ProfileForPrompt
  job: Pick<JobForPrompt, 'title' | 'company' | 'countryCode'>
  /** The job posting (or its summary): concrete company and product details to draw on. */
  posting?: string | null
  /** Oldest first; the last one is the message being answered. */
  thread: Array<{ direction: 'OUTBOUND' | 'INBOUND'; from: string; subject: string; body: string }>
  classification: string | null
  summary: string | null
  questions: string[]
  contactName: string | null
  /** Standard details from the answer bank ("Notice period: 1 month"). Unknown ones are listed in `unknown`. */
  facts: string[]
  unknown: string[]
  /** What the candidate wants this reply to do, in their own words (optional). */
  instruction?: string | null
}

/** What the candidate can offer when the obstacle is location: only the options that fit their answers. */
function locationOffers(p: Persona, countryCode?: string | null): string {
  const offers: string[] = []
  if (p.c?.relocation === 'yes' || p.c?.relocation === 'maybe') offers.push('relocate')
  if (p.c && needsSponsorshipFor(p.c, countryCode) === true) offers.push(`take care of the visa paperwork on ${p.his} side as far as the rules allow`)
  if (p.c?.remote === 'only' || p.c?.remote === 'ok') offers.push('start remotely')
  offers.push('any other arrangement they prefer')
  return offers.join(', ')
}

export function replyDraftPrompt(input: ReplyDraftInput): { system: string; prompt: string } {
  const { profile, job } = input
  const p = persona(profile.candidate, profile.fullName)
  const tz = p.c?.timezone ? `${p.his} own time zone (${p.c.timezone})` : `the candidate's time zone`
  return {
    system: `You write a short reply, as ${p.name} (first person), to an email about ${p.his} job application for ${job.title} at ${job.company}. The candidate will read it before sending.
Rules:
1. Answer what they asked, using ONLY the facts below. Never invent a salary figure, notice period, start date, document, address or work-permit status. If they ask for a fact that is not in the facts (see "unknown"), write a short placeholder in square brackets, e.g. [your salary expectation], and list it in "missing".
2. Work rights: ${workRightsRule(p, job.countryCode)} ${movePrefs(p)} Say this plainly only when it is relevant to their message.
3. If they handed the application to a colleague, address that person by first name and give a two-sentence summary of why the candidate fits, with one concrete fact from the profile.
4. If they proposed interview times, accept or offer times in both the company's time zone and ${tz}; keep it to one line.
5. If they say applications must go through a careers page, thank them briefly, say you will apply there today, and ask one useful question at most.
6. Length: 60 to 150 words. A greeting line ("Hello <their first name>," when known), one to three short paragraphs, "${p.signOff}" and the name. Very polite, humble and warm, in plain words the candidate would type ${p.self}; a short "I hope you are doing well." is fine at the start. ${HUMAN_STYLE} ${spellingFor(job.countryCode)} English. No bullet lists.
7. subject: keep the thread subject, starting with "Re: ". attachCv: true only when they asked for the CV or a document.
8. Only if the obstacle is location, relocation or sponsorship (LOCATION_ISSUE): this is a humble request, not a pitch. Thank them warmly and say the candidate fully respects their decision; one sentence on what the candidate likes about the company (from the posting or the thread, never invented); then simply ask: the candidate is ready to do whatever works for them (${locationOffers(p, job.countryCode)}), and would they please consider ${p.him} for this or any other role. No list of skills, projects or numbers. Very polite and humble, never pushy, never a claim of a permit the candidate does not have.
8b. Any decline (LOCATION_ISSUE or REJECTION): end with one humble, grateful sentence asking whether they know a recruiter, a friend or another company looking for someone like the candidate, and if so whether they would kindly pass ${p.his} profile on; thank them either way. Make it easy to say yes, never a demand.
9. ${voiceRule(p)}
Answer ONLY with JSON.`,
    prompt: [
      `Candidate profile:\n${profileBlock(profile)}`,
      input.posting ? `The job posting (company and product details you may draw on):\n${truncate(input.posting, 1500)}` : '',
      `Facts you may use:\n${input.facts.map((f) => `- ${f}`).join('\n') || '- (none)'}`,
      input.unknown.length ? `Unknown (use a placeholder if asked): ${input.unknown.join(', ')}` : '',
      `Their reply was classified as ${input.classification ?? 'unknown'}${input.summary ? ` (${input.summary})` : ''}.${input.contactName ? ` The person handling it now: ${input.contactName}.` : ''}${input.questions.length ? `\nThey ask for: ${input.questions.join('; ')}` : ''}`,
      input.instruction ? `What the candidate wants this reply to do: ${input.instruction}` : '',
      `Thread (oldest first):\n${input.thread.map((m) => `[${m.direction === 'OUTBOUND' ? 'candidate' : m.from}] Subject: ${m.subject}\n${truncate(m.body, m.direction === 'INBOUND' ? 2500 : 900)}`).join('\n\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Resume parsing (primary model)
// ---------------------------------------------------------------------------

export function parseResumePrompt(resumeText: string): { system: string; prompt: string } {
  return {
    system: `Extract a structured candidate profile from resume text, for any profession. Answer ONLY with JSON matching the schema. Use null (or an empty list) for anything the resume does not state; never guess personal details.
- facts: 6 to 12 short, specific, quotable facts (team sizes, product or client names, numbers, notable projects, employers, tools used), each 3 to 8 words, in the candidate's voice without "I" (e.g. "leads a team of 10 people", "redesigned onboarding for 2M users", "cut monthly reporting time by 40%"). These are used to make application emails concrete, so prefer things with numbers or names.
- titles: 4 to 8 job titles this person should target next, in the same field as their experience (e.g. "Senior Product Designer", "Lead Data Analyst", "Senior Software Engineer").
- skills: tools, technologies and methods as short tokens, most relevant first, max 40 (e.g. "Figma", "SQL", "React", "user research", "HubSpot").
- summary: 3 or 4 plain sentences, no buzzwords.
- yearsExperience: estimate total professional years from the dates if not stated.
- experience and education: as listed, most recent first. bullets: max 6 per role, shortened.
- givenName, familyName, email, phone (as written, with its country code when shown), city, country (ISO 3166 alpha-2 code, only when clear): from the contact block.
- links: profile URLs found in the resume (linkedin, github, portfolio, behance, dribbble, website), null when absent.
- languages: spoken languages with a level (native, fluent, professional, conversational, basic) when stated.
- profession: the one closest id of software, design, data, product, marketing, sales, operations, other.
- degree: the highest degree, as written (e.g. "BSc Computer Science").`,
    prompt: `Resume text:\n\n${truncate(resumeText, 12000)}`,
  }
}

// ---------------------------------------------------------------------------
// Cover letter + application answers (primary model) for ATS/portal applications
// ---------------------------------------------------------------------------

/** "Expected salary" for form answers: the person's own figure, or a neutral sentence. */
function salaryAnswer(profile: ProfileForPrompt): string {
  const c = profile.candidate
  const own = c?.salaryExpectation ?? profile.salaryExpectation ?? null
  if (!own) return '"Open to discussing based on the full package."'
  const withCurrency = c?.salaryCurrency && !own.toUpperCase().includes(c.salaryCurrency.toUpperCase()) ? `${own} ${c.salaryCurrency}` : own
  return `"${withCurrency}"`
}

export function coverLetterPrompt(profile: ProfileForPrompt, job: JobForPrompt, ai: AiConfig): { system: string; prompt: string } {
  const p = persona(profile.candidate, profile.fullName)
  const c = p.c
  const notice = c?.noticePeriod ? `"${c.noticePeriod}"` : 'exactly "Happy to discuss at the interview stage."'
  const start = c?.earliestStart ? `"${c.earliestStart}"` : 'exactly "Flexible, happy to discuss."'
  const location = [c?.location ? `current location "${c.location}"` : 'current location', movePrefs(p) ? `and: ${movePrefs(p)}` : ''].filter(Boolean).join(' ')
  return {
    system: `You write a short cover letter and application-form answers as ${p.name}, ${profile.headline}, in the first person, for an application to ${job.company}. Sound like a real person: a kind, capable ${p.noun} who read the posting and the company properly and honestly thinks ${p.his} experience fits. Very polite and humble, but smart and specific; never pleading, never a template.
Style: ${HUMAN_STYLE} No bullet lists, no bold. ${spellingFor(job.countryCode)} English. Tone: ${tones(p)[ai.tone]} Never use these words or phrases: ${[...BANNED_FOR_PROMPT, ...FORM_ALWAYS_AVOID].join('; ')}.
coverLetter: 150 to 210 words, 3 short paragraphs. ${openingRule(p, profile)} ${humbleRule(p)} ${proofRule(p)} ${levelRule(job.title, c)} ${confidenceRule(p)} ${companyLoveRule(p)} Near the end, one sincere sentence that the candidate is genuinely interested in this role; no visa, permit, sponsorship, relocation or location talk, no notice period or start date. ${CLOSING_RULE} Then the name. ${NOT_GENERIC}
answers: short, direct answers a form would ask for. whyCompany: 2 to 4 sentences: one checkable fact about the company or product from the posting, the matching work the candidate has done (with a number when there is one), and what ${p.he} ${p.he === 'they' ? 'want' : 'wants'} to own there; no "exciting", no praise without a fact. whyRole: 2 to 4 sentences on the role's actual work and the candidate's matching experience. noticePeriod: ${notice}. earliestStart: ${start}. salaryExpectation: ${salaryAnswer(profile)}. visaStatus: one or two honest first-person sentences based on this: ${workRightsRule(p, job.countryCode)} location: ${location}.
${voiceRule(p)} Never claim a skill that is not in the profile: ${profile.stopSkills.join(', ') || 'none listed'}. Answer ONLY with JSON.`,
    prompt: `Candidate profile:\n${profileBlock(profile)}\n\nJob:\n${jobBlock(job, 2500)}${job.hook ? `\n\nSuggested angle: ${job.hook}` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Follow-up (primary model)
// ---------------------------------------------------------------------------

export function followUpPrompt(input: {
  profile: ProfileForPrompt
  job: JobForPrompt
  originalSubject: string
  originalBody: string
  sentDaysAgo: number
  rewrite?: { subject: string; body: string; findings: string }
}): { system: string; prompt: string } {
  const { profile, job } = input
  const p = persona(profile.candidate, profile.fullName)
  return {
    system: `You write a short, polite follow-up email in the same thread as an earlier job application, as ${p.name}, first person.
Rules: 50 to 90 words in the body. Very polite and humble, plain words the candidate would type ${p.self}. A greeting line ("Hello <first name>," or "Hello <company> team,"), ONE paragraph, then "${p.signOff}" and the name. Mention the role and that you wrote about ${input.sentDaysAgo} days ago. No pressure, no guilt, no "just checking in", no "circling back", no "bumping this". Add one small new piece of information or a specific, gentle question, then one low-key ask and a short thank-you. ${HUMAN_STYLE} ${spellingFor(job.countryCode)} English. Subject: start with "Following up: " and the role name. ${voiceRule(p)}
Output ONLY JSON: {"subject": "...", "body": "..."}.`,
    prompt: [
      `Original email:\nSubject: ${input.originalSubject}\n${input.originalBody}`,
      `Job: ${job.title} at ${job.company}`,
      `Candidate facts: ${profile.facts.join('; ')}`,
      input.rewrite ? `A previous follow-up draft was rejected. Fix every finding:\n${input.rewrite.findings}\n\nPrevious subject: ${input.rewrite.subject}\nPrevious body:\n${input.rewrite.body}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

// ---------------------------------------------------------------------------
// Application forms (browser agent)
// ---------------------------------------------------------------------------

/** The name for agent prompts: the person's name, or a neutral word on a fresh install. */
function agentName(c: CandidateContext): string {
  return c.fullName || 'the candidate'
}

/**
 * A second look at a form the agent could not finish: the screenshot plus what the scanner saw. Small,
 * safe steps only; the agent itself presses Next and Submit afterwards.
 */
export function formFixPrompt(input: {
  job: { title: string; company: string; countryCode?: string | null }
  /** The person the form is for; work rights and pronouns come from here. */
  candidate: CandidateContext
  reason: string
  url: string
  recentLog: string[]
  fields: Array<{ label: string; kind: string; value: string; required: boolean; error?: string; options?: string[] }>
  buttons: Array<{ text: string; kind: string; disabled: boolean }>
  errors: string[]
  pageText: string
  facts: string[]
  lessons: string[]
}): { system: string; prompt: string } {
  const p = persona(input.candidate)
  return {
    system: `You are a careful helper looking over the shoulder of a browser agent that is applying for a job for ${agentName(input.candidate)} (${input.job.title} at ${input.job.company}). The agent got stuck on the form shown in the screenshot. Find out why, and give at most six small steps that let the agent continue.
Rules:
1. Look at the screenshot first: red error text, empty required boxes, a pop-up or dialog over the form, a box whose question the agent read wrongly, a list that needs an option picked, a box that needs a specific format ("http://example.com", digits only, dd/mm/yyyy).
2. Steps: "click" a button by its exact text (pop-up buttons such as Agree, Accept, Close, Continue, Add, Save are fine), "fill" a text box, "choose" an option, "check" a checkbox, "wait" when the page is still loading. Copy targets exactly from the lists. An empty CV / resume upload is fixable: "click" its upload button (any language: Upload, Subir currículum, Hochladen, Choose file) and ${p.his} CV file is attached for you. Never press a button that clears or deletes files.
3. Never click Submit, Apply, Send, Sign up, Register, Create account, Log in or Subscribe: the agent presses Submit itself afterwards. Never solve a CAPTCHA.
4. Values only from the candidate facts below or by fixing the format of what is already typed. Never invent a fact; a job title or school must be one from the facts, exactly. Visa and right to work have one true answer: ${workRightsRule(p, input.job.countryCode)} Never change answers about citizenship, salary, gender or any diversity question: those come from the candidate's own saved answers.
5. If the only fix needs something only the candidate knows (a password, a code sent by email, a document not given), return no steps and say so in the diagnosis.
6. lesson: one sentence that would help the next agent on this site (for example "Oracle Cloud: press Agree in the Terms pop-up after ticking the box"), or null. Never put the candidate's name, email, phone or address in a lesson.
Answer ONLY with JSON.`,
    prompt: [
      `Why the agent stopped: ${input.reason}`,
      `Page: ${input.url}`,
      input.lessons.length ? `What helped on this site before:\n${input.lessons.map((l) => `- ${l}`).join('\n')}` : '',
      `Agent's last steps:\n${input.recentLog.map((l) => `- ${l}`).join('\n')}`,
      `Errors shown on the page: ${input.errors.join(' | ') || 'none read'}`,
      `Fields (label, kind, current value, required, error, options):\n${JSON.stringify(input.fields)}`,
      `Buttons:\n${JSON.stringify(input.buttons)}`,
      `Visible text (start):\n${input.pageText.slice(0, 1500)}`,
      `Candidate facts:\n${input.facts.map((f) => `- ${f}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

/**
 * The AI form driver: one step of reading the page's accessibility snapshot and choosing the next
 * actions, the way a person (or Claude with a browser tool) finishes a form the rule-based agent could not.
 */
export function driverPrompt(input: {
  job: { title: string; company: string; countryCode?: string | null }
  /** The person the form is for; name, phone, work rights and pronouns come from here. */
  candidate: CandidateContext
  url: string
  why: string
  snapshot: string
  history: string[]
  facts: string[]
  coverLetter: string | null
  lessons: string[]
  /** How earlier runs got past the places where they were stuck on this kind of site. */
  hints?: string[]
  mayPressSubmit: boolean
  /** A screenshot of the visible part of the page is attached. */
  hasScreenshot?: boolean
}): { system: string; prompt: string } {
  const p = persona(input.candidate)
  const phone = input.candidate.phoneIntl ? ` (${input.candidate.phoneIntl})` : ''
  return {
    system: `You finish a job application form in a real browser for ${agentName(input.candidate)} (${input.job.title} at ${input.job.company}). Each turn you get the page's accessibility snapshot, where every element has a [ref=...]. It already contains the WHOLE page, also everything below the visible screen: never scroll, never wait to "see more", act on any field in it directly. Give the next actions (at most 15) using those refs; fill as many fields as you can each turn. After they run you get a fresh snapshot.${input.hasScreenshot ? ' You also get a screenshot of the visible part of the page: look at it first to recognise the page template (name it in "pattern"), which step of the form you are on, pop-ups and cookie banners, red error messages, CAPTCHAs and whether the page looks finished. Act only through refs from the snapshot; the screenshot is for understanding. A dark "Job Pilot" panel in the top right corner is ours, not part of the site: ignore it.' : ''}
When the template matches what worked before on this kind of site (listed below), follow that pattern step by step. When it is new to you, work it out and write the general rule you found in "lesson".
How to work:
1. Fill every required field (marked * or "required") that is empty or wrong. Look for red error text and fix exactly what it asks for.
2. Text boxes: "fill" with the answer. Searchable dropdowns (combobox): "click" it, "fill" the text, then in a later turn "click" the matching option from the list (or "press" ArrowDown then Enter when the options are not in the snapshot; suggestion lists can take 2 seconds, so "wait" 2000 first). A <select>: "select" with the option text. Radio buttons and checkboxes: "click" the option (or its label).
2b. Sites that read the CV may add work or education entries by themselves; an entry missing a required field (an empty Title) blocks the form: fill it from the candidate's real jobs in the facts and save it, or delete that one entry with its own Delete button. Never write ";" in a text box (some sites refuse it): use a comma.
3. A list of documents already uploaded to choose the resume from (LinkedIn Easy Apply "Resume" step): click the one that is the candidate's CV (its name has "CV" or "Resume"), never a cover letter, even when the cover letter is pre-selected. Uploads work: ${p.his} CV file is ready on this computer and is attached for you. For an empty CV / resume upload, use "upload_cv" with the ref of the upload button or link (any language: Upload a file, Choose file, Subir currículum, Hochladen) and value null; never say you cannot upload. "upload_cover_letter" works the same for a cover letter upload (only when a cover letter text is given below). Never press a button that clears, removes or deletes files.
4. Phone: type the full international number from the facts${phone}, with its + country code, into the phone box; the site sets the country itself. Dates: follow the format the box shows; for month/year pickers click the year arrows then the month.
5. Use ONLY the facts below. Never invent employers, dates, degrees, numbers or skills. Marital or personal status, children, religion beyond the saved diversity answers, tax / social-security / ID numbers: never choose or invent; leave them (needs_human naming the field when required). "Years of experience with <a tool or technology>" questions: count only years for that exact tool from the facts (total years are NOT years per tool); a tool not in the facts is 0 (or "No" / "None") - a site once got "5 years" for a language the candidate never used. Visa and right to work: ${workRightsRule(p, input.job.countryCode)} Diversity questions: use the candidate's saved answers in the facts; otherwise pick the prefer-not-to-say / decline option. Salary: use the salary expectation in the facts only for EXPECTED / desired salary; the CURRENT salary is not in the facts, so a "current / present / base salary today" question stays empty when optional, or status needs_human when required (never put the expectation there). When the form asks in another currency or per month, convert it (1 EUR is about 1.08 USD, 0.85 GBP, 4.3 PLN, 7.45 DKK, 11.5 SEK, 0.95 CHF; per month = yearly / 12) and round. A question only the candidate can answer (a fact not in the list, a password, an emailed code) means status needs_human.
6. Never create an account, type a password, sign in, or solve a CAPTCHA: status needs_human with the reason.
7. ${input.mayPressSubmit ? 'When every field is filled and correct, click the Submit / Send / Apply button. After it, if the page says the application was received or submitted, status submitted.' : 'Do NOT press Submit / Send / Apply: when every field is filled and correct, status submitted with reason "ready for review".'} Multi-step forms: press Next / Continue / Save and continue between pages.
8. Free-text questions (why this company, motivation, cover letter box): 60 to 150 words, first person, plain sentences a person would type, no em dashes. Very polite and humble, but specific: name the role, say what in the posting caught the candidate's interest, give two real proofs from the jobs in the facts (with their numbers), and one sentence on why this company ("I think", "I would be glad to", never big claims). Use the cover letter text when it fits. Never "eager", "excited", "passionate".
9. lesson: one short, general sentence about this kind of site that would help next time (for example "Recruitee: the phone box takes the full international number with the + code"), or null. Never put the candidate's name, email, phone or address in a lesson.
Answer ONLY with JSON.`,
    prompt: [
      `Page: ${input.url}`,
      `Why you were called: ${input.why}`,
      input.lessons.length ? `What worked on this kind of site before:\n${input.lessons.map((l) => `- ${l}`).join('\n')}` : '',
      input.hints?.length ? `Where earlier runs on this kind of site got stuck, and how to get past it:\n${input.hints.map((l) => `- ${l}`).join('\n')}` : '',
      input.history.length ? `Your earlier actions on this form (newest last):\n${input.history.map((h) => `- ${h}`).join('\n')}` : '',
      `Candidate facts:\n${input.facts.map((f) => `- ${f}`).join('\n')}`,
      input.coverLetter ? `Cover letter text (for cover letter or motivation boxes):\n${input.coverLetter.slice(0, 2500)}` : '',
      `Accessibility snapshot:\n${input.snapshot}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

/**
 * Why a form could not be finished: read from a screenshot of where it stopped, the page snapshot and
 * what was tried. The answer is shown to the person in the app and teaches the next run on the same kind of site.
 */
export function diagnosePrompt(input: { url: string; job: { title: string; company: string }; candidate: CandidateContext; reason: string; snapshot: string; history: string[] }): { system: string; prompt: string } {
  return {
    system: `You review a job application form that an automatic agent could not finish for ${agentName(input.candidate)} (${input.job.title} at ${input.job.company}). You get a screenshot of the page where it stopped, the page's accessibility snapshot, the agent's own reason and its last actions. Say exactly what blocks the form now, as it shows on the page (an error message, an empty required field, a sign-in wall, a CAPTCHA, a widget that will not take the value, a closed posting). Name the page template. When an agent could get past it on this kind of site, give one concrete technique in fixHint (which element, what to click or type, in what order); when only the candidate can (CAPTCHA, account or password, a question about the candidate that is not answered, closed posting, knockout), fixHint is null. Never suggest creating an account, typing a password, solving a CAPTCHA or giving an untrue answer. Never put the candidate's name, email, phone or address in fixHint. Answer ONLY with JSON.`,
    prompt: [
      `Page: ${input.url}`,
      `The agent's reason: ${input.reason}`,
      input.history.length ? `Its last actions (newest last):\n${input.history.map((h) => `- ${h}`).join('\n')}` : '',
      `Accessibility snapshot:\n${input.snapshot}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}

export interface FormFieldForPrompt {
  key: string
  label: string
  kind: string
  required: boolean
  options?: string[]
  maxLength?: number | null
  section?: string
  error?: string
}

/**
 * Rewrite of written form answers that kept a banned phrase ("eager", "passionate"...). Same
 * facts, same length, first person; the result is checked again and dropped when it still fails.
 */
export function rewriteFormTextPrompt(input: { profile: ProfileForPrompt; job: JobForPrompt; items: Array<{ key: string; label: string; text: string; avoid: string[]; maxLength: number | null }> }): { system: string; prompt: string } {
  const p = persona(input.profile.candidate, input.profile.fullName)
  return {
    system: `You edit answers that ${p.name} wrote on a job application form for ${input.job.title} at ${input.job.company}. Rewrite each text so it no longer contains any of the words or phrases listed in its "avoid" list, nor: ${[...BANNED_FOR_PROMPT, ...FORM_ALWAYS_AVOID].join('; ')}. Keep every fact, number, name and the first person exactly; keep the length (and stay under maxLength when one is given); change only the wording around the banned phrases. ${HUMAN_STYLE} Return one entry per key with the new text in "value", "choices" null, "needsHuman" false and "reason" null. Answer ONLY with JSON.`,
    prompt: `Texts (JSON):\n${JSON.stringify(input.items.map((i) => ({ key: i.key, question: i.label, text: i.text, avoid: i.avoid, maxLength: i.maxLength })))}`,
  }
}

/** Words the writing rules ban in every application text, beyond the Settings list. */
const FORM_ALWAYS_AVOID = ['eager', 'excited', 'exciting', 'thrilled', 'passionate', 'dream company']

const DIVERSITY_LABELS: Record<keyof Diversity, string> = {
  gender: 'gender',
  orientation: 'sexual orientation',
  ethnicity: 'ethnicity',
  religion: 'religion',
  disability: 'disability',
  veteran: 'veteran status',
  caring: 'caring responsibilities',
  maritalStatus: 'marital status',
  ageRange: 'age range',
}

/** The diversity answers the person chose to give in the profile, for the form prompt. */
function diversityLine(c?: CandidateContext): string {
  if (!c) return ''
  const given = (Object.keys(DIVERSITY_LABELS) as Array<keyof Diversity>)
    .map((k) => {
      const v = c.diversity[k]
      return typeof v === 'string' && v.trim() ? `${DIVERSITY_LABELS[k]}: ${v.trim()}` : null
    })
    .filter(Boolean)
  return given.length ? ` The candidate's own answers: ${given.join('; ')}.` : ''
}

/**
 * Answers for the questions of one application-form page that the rules and the answer bank
 * could not answer. Truthfulness first: unknown personal facts go back to the candidate.
 */
export function formAnswersPrompt(input: {
  profile: ProfileForPrompt
  job: JobForPrompt
  saved: Array<{ question: string; answer: string }>
  facts: string[]
  fields: FormFieldForPrompt[]
}): { system: string; prompt: string } {
  const { profile, job } = input
  const p = persona(profile.candidate, profile.fullName)
  const c = p.c
  const leaving = c?.motivation
    ? `"Why are you leaving / looking": built on the candidate's own reason ("${c.motivation}"), forward-looking, never a bad word about the current employer or its clients.`
    : '"Why are you leaving / looking": forward-looking (bigger ownership, a team and product the candidate believes in), never a bad word about the current employer or its clients.'
  const howHeard = c?.howHeard ?? 'online job boards'
  return {
    system: `You fill in a job application form for ${p.name}, applying to ${job.title} at ${job.company}. You answer each field with what the candidate would truthfully answer.
Rules:
1. Use ONLY the candidate profile, the candidate facts and the saved answers below. Never invent employers, dates, degrees, certificates, licences, security clearances, salary figures, addresses, ID numbers, references, criminal or medical history. If a field asks for a personal fact you were not given, return value null and needsHuman true.
2. Work authorisation: ${workRightsRule(p, job.countryCode)} ${movePrefs(p)}
3. Yes/no questions about skills or experience: answer from the profile. If a skill or tool is not in the profile, answer No (or the closest truthful option). Years with a specific tool or technology: estimate only from the dated experience in the profile; if unclear, give a conservative number.
4. Choice fields (select, radio, combobox, listbox, buttons): "value" must be one option label copied exactly. Checkbox groups: put the chosen labels in "choices". Single checkbox: value "Yes" to tick, "No" to leave unticked.
5. Diversity / EEO questions: use the saved answer when one covers the question;${diversityLine(c)} otherwise pick the "prefer not to say" / "decline" option when there is one.
6. Free-text questions: first person, specific to this posting and to real things in the profile, 60 to 150 words unless the field shows a shorter limit. Lead with the strongest real evidence (a project with its number), prefer a concrete situation over adjectives, say "I" for what the candidate did personally (not "we"). By question: "why us / why this company": one checkable fact about the company from the posting, then the matching work the candidate has done, then what ${p.he} ${p.he === 'they' ? 'want' : 'wants'} to own there (2 to 4 sentences). "A project you are proud of": one project, context in one sentence, what the candidate did, one trade-off chosen, the measured result, what ${p.he} would do differently now. "Biggest challenge": a real problem from the work, the candidate's decision, the outcome, the lesson. ${leaving} ${levelRule(job.title, c)} Answer each question on its own subject. The confidence line (${confidenceRule(p)}) goes in ONE answer only, the motivation or "anything else" one; never paste the candidate's mindset text, and never repeat a sentence across answers on the form. Never use these words or phrases: ${[...BANNED_FOR_PROMPT, ...FORM_ALWAYS_AVOID].join('; ')}. ${voiceRule(p)} ${HUMAN_STYLE}
7. Short text fields: short answers, no full sentences unless asked. Numbers as digits only when the field is a number.
8. Optional fields you have no good answer for: value null, needsHuman false.
9. A field may show an error message from the site; fix the answer so the error goes away.
10. Questions with no factual answer in the profile (how did you hear about us, preferences, willingness to travel or work hybrid, comfort with the office policy, how you like to work, rating your own level from the profile): give the sensible answer a strong candidate in their situation would give; for "how did you hear about us" the candidate usually finds jobs through ${howHeard}. Do not stop for these. needsHuman is only for personal facts you were not given (rule 1) and for unusual legal declarations.
Return exactly one entry per field key. Answer ONLY with JSON.`,
    prompt: [
      `Candidate profile:\n${profileBlock(profile)}`,
      input.facts.length ? `Candidate facts:\n${input.facts.map((f) => `- ${f}`).join('\n')}` : '',
      input.saved.length ? `Saved answers (question -> answer):\n${input.saved.map((a) => `- ${a.question} -> ${a.answer}`).join('\n')}` : '',
      `Job:\n${jobBlock(job, 1800)}`,
      `Fields to answer (JSON):\n${JSON.stringify(input.fields)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }
}
