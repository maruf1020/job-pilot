import { ATS_TYPES, type AtsType } from '@/lib/domain'

/** Company row as stored (Prisma Company model, dates as ISO strings). */
export interface CompanyBase {
  id: string
  name: string
  normalizedName: string
  domain: string | null
  countryCode: string | null
  atsType: string | null
  atsSlug: string | null
  careersUrl: string | null
  contactEmail: string | null
  contactEmailSource: string | null
  contactCandidates: string[]
  contactCheckedAt: string | null
  contactNotes: string | null
  knownSponsor: boolean
  blacklisted: boolean
  notes: string | null
  lastFetchedAt: string | null
  lastFetchError: string | null
  /** How the ATS board was found: job-link | register | probe | curated | manual. */
  boardSource?: string | null
  boardCheckedAt?: string | null
  /** Jobs on the board matching the search rules when last counted (title, stack, location or remote); null = not counted yet. */
  boardMatchingJobs?: number | null
  boardMatchedAt?: string | null
  createdAt: string
  updatedAt: string
}

/** GET /api/companies row. */
export interface CompanyRow extends CompanyBase {
  _count: { jobs: number }
  /** Sent applications (list rows only). */
  applications?: { count: number; lastSentAt: string | null }
}

/** Recent job as selected by GET /api/companies/[id]. */
export interface CompanyJobRow {
  id: string
  title: string
  countryCode: string | null
  status: string
  firstSeenAt: string
  score: { finalScore: number } | null
}

/** GET /api/companies/[id]. */
export interface CompanyDetail extends CompanyRow {
  jobs: CompanyJobRow[]
}

/** POST /api/companies/[id]/fetch result. */
export interface FetchBoardResult {
  fetched: number
  created: number
  updated: number
  requests: number
  ms: number
}

/** Controlled form state (strings for inputs, sentinel-free). */
export interface CompanyFormValues {
  name: string
  domain: string
  countryCode: string
  atsType: string
  atsSlug: string
  careersUrl: string
  contactEmail: string
  knownSponsor: boolean
  blacklisted: boolean
  notes: string
}

/** Body accepted by POST /api/companies and PATCH /api/companies/[id] (companySchema). */
export interface CompanyPayload {
  name: string
  domain: string | null
  countryCode: string | null
  atsType: AtsType | null
  atsSlug: string | null
  careersUrl: string | null
  contactEmail: string | null
  knownSponsor: boolean
  blacklisted: boolean
  notes: string | null
}

export const EMPTY_COMPANY_FORM: CompanyFormValues = {
  name: '',
  domain: '',
  countryCode: '',
  atsType: '',
  atsSlug: '',
  careersUrl: '',
  contactEmail: '',
  knownSponsor: false,
  blacklisted: false,
  notes: '',
}

export function companyToForm(c: CompanyBase): CompanyFormValues {
  return {
    name: c.name,
    domain: c.domain ?? '',
    countryCode: c.countryCode ?? '',
    atsType: c.atsType ?? '',
    atsSlug: c.atsSlug ?? '',
    careersUrl: c.careersUrl ?? '',
    contactEmail: c.contactEmail ?? '',
    knownSponsor: c.knownSponsor,
    blacklisted: c.blacklisted,
    notes: c.notes ?? '',
  }
}

const nullable = (s: string): string | null => {
  const t = s.trim()
  return t ? t : null
}

function isAtsType(v: string): v is AtsType {
  return (ATS_TYPES as readonly string[]).includes(v)
}

export function formToPayload(v: CompanyFormValues): CompanyPayload {
  const country = v.countryCode.trim().toUpperCase()
  return {
    name: v.name.trim(),
    domain: nullable(v.domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')),
    countryCode: country ? country : null,
    atsType: isAtsType(v.atsType) ? v.atsType : null,
    atsSlug: nullable(v.atsSlug),
    careersUrl: nullable(v.careersUrl),
    contactEmail: nullable(v.contactEmail),
    knownSponsor: v.knownSponsor,
    blacklisted: v.blacklisted,
    notes: nullable(v.notes),
  }
}

/** Client-side check mirroring companySchema; returns a message or null. */
export function validateCompanyForm(v: CompanyFormValues): string | null {
  if (!v.name.trim()) return 'Name is required'
  if (v.name.trim().length > 200) return 'Name is too long'
  const cc = v.countryCode.trim()
  if (cc && !/^[A-Za-z]{2}$/.test(cc)) return 'Country must be a 2-letter ISO code'
  const url = v.careersUrl.trim()
  if (url && !/^https?:\/\/\S+$/i.test(url)) return 'Careers URL must start with http:// or https://'
  const email = v.contactEmail.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Contact email looks invalid'
  if (v.atsType && !v.atsSlug.trim()) return 'ATS slug is required when an ATS type is set'
  if (v.notes.length > 5000) return 'Notes are too long'
  return null
}
