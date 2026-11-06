import { z } from 'zod'
import { APPLY_CHANNELS, REPLY_CLASSIFICATIONS, SENIORITIES, SPONSORSHIP_LEVELS } from '@/lib/domain'

/**
 * Zod schemas for every structured LLM output. They double as the JSON schema
 * handed to Gemini (`z.toJSONSchema`) and as the runtime validator.
 */

export const enrichItemSchema = z.object({
  id: z.string().describe('The job id given in the input, copied verbatim'),
  sponsorship: z.enum(SPONSORSHIP_LEVELS).describe('yes = explicitly offers visa/work permit sponsorship or relocation for non-EU hires; likely = strong hints (international team, relocation package, "we hire globally"); no = explicitly requires existing right to work / no sponsorship; unknown otherwise'),
  sponsorshipEvidence: z.array(z.string()).max(4).describe('Short verbatim quotes from the posting that support the sponsorship verdict'),
  seniority: z.enum(SENIORITIES),
  requiredLanguages: z.array(z.string()).describe('Human languages the role REQUIRES (e.g. "German"). Empty if English only or not stated'),
  mustHaveSkills: z.array(z.string()).max(10).describe('Hard requirements, short tokens like "React", "Node.js", "PostgreSQL"'),
  niceToHaveSkills: z.array(z.string()).max(10),
  salaryEurMin: z.number().nullable().describe('Annual minimum salary converted to EUR if stated, else null'),
  contactEmail: z.string().nullable().describe('An email address to send applications to, if the posting gives one, else null'),
  applyChannel: z.enum(APPLY_CHANNELS).describe('email if applications go to an email address; ats if an application form/ATS; portal if a company careers portal; unknown otherwise'),
  relocationSupport: z.boolean().nullable(),
  summary: z.string().max(400).describe('Two plain sentences: what the team builds and what the role does'),
})
export type EnrichItem = z.infer<typeof enrichItemSchema>

export const enrichBatchSchema = z.object({ items: z.array(enrichItemSchema) })

export const rankItemSchema = z.object({
  id: z.string(),
  fit: z.number().min(0).max(100).describe('0-100 how well the candidate fits this specific role'),
  reasons: z.array(z.string()).max(5).describe('Concrete reasons for the fit score'),
  gaps: z.array(z.string()).max(5).describe('Concrete gaps or risks'),
  oneLineHook: z.string().max(200).describe('One specific sentence linking the candidate to THIS role/company, usable as an email opener. Plain words. No buzzwords.'),
})
export type RankItem = z.infer<typeof rankItemSchema>
export const rankBatchSchema = z.object({ items: z.array(rankItemSchema) })

export const draftSchema = z.object({
  subject: z.string().max(80),
  body: z.string().max(2500),
})
export type DraftOutput = z.infer<typeof draftSchema>

export const judgeSchema = z.object({
  aiLikelihood: z.number().min(0).max(100).describe('0 = clearly written by a person, 100 = clearly machine-generated'),
  tells: z.array(z.string()).max(8).describe('Exact phrases or patterns that give it away'),
  suggestions: z.array(z.string()).max(6).describe('Specific edits that would make it read as human'),
})
export type JudgeOutput = z.infer<typeof judgeSchema>

export const replyClassificationSchema = z.object({
  classification: z.enum(REPLY_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(300).describe('One or two sentences: what the sender wants'),
  suggestedNextAction: z.string().max(200).nullable(),
  proposedTimes: z.array(z.string()).max(5).describe('Any interview times/dates mentioned, verbatim'),
  applyUrl: z.string().max(500).nullable().describe('The careers page or job link they ask you to use, verbatim, or null'),
  contact: z
    .object({ name: z.string().max(100), email: z.string().max(200).nullable(), role: z.string().max(100).nullable() })
    .nullable()
    .describe('A named person who handles the application now (handed over, copied in, or signed the reply), or null'),
  questions: z.array(z.string().max(200)).max(8).describe('What they ask the candidate to send or answer, one item each'),
})
export type ReplyClassification = z.infer<typeof replyClassificationSchema>

/** A reply to a recruiter's email, written for the candidate to review and send. */
export const replyDraftSchema = z.object({
  subject: z.string().max(200),
  body: z.string().max(4000).describe('Plain text, greeting to sign-off'),
  attachCv: z.boolean().describe('True when they asked for the CV or it clearly helps'),
  missing: z.array(z.string().max(120)).max(6).describe('Facts they asked for that the candidate must fill in themselves (marked [like this] in the body)'),
})
export type ReplyDraftOutput = z.infer<typeof replyDraftSchema>

/** Profession ids, kept in step with PROFESSIONS in src/lib/candidate/context.ts. */
const RESUME_PROFESSIONS = ['software', 'design', 'data', 'product', 'marketing', 'sales', 'operations', 'other'] as const

export const resumeProfileSchema = z.object({
  fullName: z.string(),
  givenName: z.string().nullable().describe('First / given name(s) as written'),
  familyName: z.string().nullable().describe('Family name / surname as written'),
  headline: z.string().describe('Current title, e.g. "Senior Product Designer"'),
  email: z.string().nullable(),
  phone: z.string().nullable().describe('As written, with the country code when shown'),
  location: z.string().nullable().describe('"City, Country" when the resume states it'),
  city: z.string().nullable(),
  country: z.string().nullable().describe('ISO 3166-1 alpha-2 code of the country of residence, only when clear'),
  links: z
    .object({
      linkedin: z.string().nullable(),
      github: z.string().nullable(),
      portfolio: z.string().nullable(),
      behance: z.string().nullable(),
      dribbble: z.string().nullable(),
      website: z.string().nullable(),
    })
    .nullable()
    .describe('Profile URLs found in the resume; null when absent'),
  profession: z.enum(RESUME_PROFESSIONS).nullable().describe('The closest profession for this person'),
  degree: z.string().nullable().describe('Highest degree as written, e.g. "BSc Computer Science"'),
  yearsExperience: z.number().describe('Total professional years, estimate if not explicit'),
  summary: z.string().max(800).describe('3-4 plain sentences summarising the candidate'),
  skills: z.array(z.string()).max(40).describe('Tools, technologies and methods as short tokens'),
  titles: z.array(z.string()).max(10).describe('Job titles this candidate should target'),
  facts: z.array(z.string()).max(15).describe('Short, specific, quotable facts: team sizes, product names, numbers, notable projects. 3-8 words each'),
  languages: z
    .array(z.object({ name: z.string(), level: z.string().nullable().describe('native | fluent | professional | conversational | basic') }))
    .describe('Spoken languages with a level when stated'),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      from: z.string().nullable(),
      to: z.string().nullable(),
      bullets: z.array(z.string()).max(6),
    }),
  ),
  education: z.array(z.object({ school: z.string(), degree: z.string(), year: z.string().nullable() })),
})
export type ResumeProfile = z.infer<typeof resumeProfileSchema>

export const coverLetterSchema = z.object({
  coverLetter: z.string().max(3000).describe('Plain-text cover letter, 180-260 words, same style rules as the email'),
  answers: z.object({
    whyCompany: z.string().max(600),
    whyRole: z.string().max(600),
    noticePeriod: z.string().max(120),
    salaryExpectation: z.string().max(160),
    visaStatus: z.string().max(300),
    location: z.string().max(200),
    earliestStart: z.string().max(120),
  }),
})
export type CoverLetterOutput = z.infer<typeof coverLetterSchema>

export const formAnswersSchema = z.object({
  answers: z.array(
    z.object({
      key: z.string().describe('The field key, copied exactly'),
      value: z.string().nullable().describe('Text to enter or the exact option label to choose; null when you cannot answer truthfully'),
      choices: z.array(z.string()).nullable().describe('Checkbox groups / multi-selects: exact option labels; otherwise null'),
      needsHuman: z.boolean().describe('True when only the candidate can answer (a personal fact you were not given)'),
      reason: z.string().nullable().describe('Short reason when needsHuman is true'),
    }),
  ),
})
export type FormAnswersOutput = z.infer<typeof formAnswersSchema>

/** Which button moves an application flow forward, or that a person must step in. */
export const navDecisionSchema = z.object({
  action: z
    .enum(['click', 'done', 'open', 'email', 'closed', 'human'])
    .describe('click a button/link, done = this page is the application form, open = go to an application URL written in the text, email = applications go by email, closed = the job is filled or closed, human = a person must help'),
  key: z.string().nullable().describe('Key of the button or link to click when action is click'),
  url: z.string().nullable().describe('The application or careers URL written in the page text, when action is open'),
  email: z.string().nullable().describe('The address applications go to, when action is email'),
  reason: z.string().describe('One short sentence'),
})
export type NavDecision = z.infer<typeof navDecisionSchema>

/** A second look at a form an agent got stuck on: what went wrong, a few small steps to fix it, and the lesson. */
export const formFixSchema = z.object({
  diagnosis: z.string().describe('One or two sentences: why the form did not move on'),
  actions: z
    .array(
      z.object({
        type: z.enum(['click', 'fill', 'choose', 'check', 'wait']).describe('click a button by its text, fill a text box, choose an option, tick a checkbox, or wait for the page'),
        target: z.string().describe('The button text or the field label, copied from the lists'),
        value: z.string().nullable().describe('Text to type or the option to choose; null for click, check and wait'),
      }),
    )
    .max(6)
    .describe('At most six steps, in order; empty when nothing safe can be done'),
  lesson: z.string().nullable().describe('One sentence for next time on this site, or null'),
})
export type FormFix = z.infer<typeof formFixSchema>

/** One step of the Gemini form driver: what it sees, the next few actions, and whether it is done. */
export const driverStepSchema = z.object({
  pattern: z.string().describe('Short name of the page template you recognise from the screenshot and snapshot, e.g. "SmartRecruiters one-click apply, screening questions" or "custom WordPress form, single page"'),
  thought: z.string().describe('One or two sentences: what the page shows now and what is still missing'),
  actions: z
    .array(
      z.object({
        type: z
          .enum(['fill', 'click', 'select', 'check', 'uncheck', 'upload_cv', 'upload_cover_letter', 'press', 'wait'])
          .describe('fill a text box, click a button/link/option, select an option of a <select>, tick or untick a box, put the CV or cover letter into a file input or upload button, press a key (Enter, ArrowDown, Tab, Escape), or wait'),
        ref: z.string().nullable().describe('The [ref=...] of the element from the snapshot (e12), or null for press and wait'),
        value: z.string().nullable().describe('Text to type, option to select, key to press, or milliseconds to wait'),
      }),
    )
    .max(15),
  status: z.enum(['continue', 'submitted', 'needs_human']).describe('continue after these actions, submitted when the page confirms the application, needs_human when only the candidate can go on'),
  reason: z.string().describe('Why, in one sentence'),
  lesson: z.string().nullable().describe('One sentence about this kind of application site that would help next time, or null'),
})
export type DriverStep = z.infer<typeof driverStepSchema>

export const FAILURE_CATEGORIES = ['captcha', 'account', 'missing_answer', 'widget', 'validation', 'navigation', 'closed', 'knockout', 'already_applied', 'other'] as const
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number]

/** Why a form could not be finished, read from a screenshot of where it stopped. */
export const failureDiagnosisSchema = z.object({
  category: z
    .enum(FAILURE_CATEGORIES)
    .describe('captcha; account (sign-in, register, password); missing_answer (a question only the candidate can answer); widget (a dropdown, date picker, upload or button that would not take the input); validation (the site shows an error on a field); navigation (no form found, wrong page, Apply button leads elsewhere); closed (posting gone); knockout (not eligible after a truthful answer); already_applied; other'),
  pattern: z.string().describe('Short name of the page template, e.g. "Workday apply manually, My Information step"'),
  blocker: z.string().describe('One sentence: exactly what stops the form now, as seen on the page'),
  field: z.string().nullable().describe('Label of the field or button involved, or null'),
  fixHint: z.string().nullable().describe('One concrete sentence on how an agent gets past this next time on this kind of site (which element, what to click or type), or null when only the candidate can (captcha, account, missing answer, closed)'),
})
export type FailureDiagnosis = z.infer<typeof failureDiagnosisSchema>

/** Status of one application read from a candidate portal page or an email. */
export const portalStatusSchema = z.object({
  found: z.boolean().describe('True when the page/email clearly refers to this application'),
  status: z.enum(['SUBMITTED', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN', 'CLOSED', 'UNKNOWN']),
  evidence: z.string().describe('The words on the page that show the status'),
})
export type PortalStatusOutput = z.infer<typeof portalStatusSchema>

/** Gemini-compatible JSON schema (no $schema key, no unsupported keywords). */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>
  delete json.$schema
  return stripUnsupported(json) as Record<string, unknown>
}

function stripUnsupported(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupported)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue
      out[k] = stripUnsupported(v)
    }
    return out
  }
  return node
}
