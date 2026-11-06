/**
 * Which mailboxes an application may be sent to. Job postings routinely mention
 * addresses that are wrong for an application (accommodation requests, privacy,
 * press, support…); those must never become a recipient.
 */
export const UNUSABLE_LOCAL_RE =
  /(accommodat|accessib|disabilit|privacy|datenschutz|dpo|gdpr|legal|trademark|copyright|dmca|press|media|abuse|security|billing|invoice|sales|marketing|support|help|noreply|no-reply|donotreply|do-not-reply|unsubscribe|webmaster|postmaster|investor|partnership|compliance|whistle|example|test|admin@|fraud|scam|phishing|complaint|opt-?out|advertis|newsletter|career-?advice|jobseeker|candidate-?support)/i

/** Asset file names that look like addresses on a web page (logo@2x.png, flags@2x.webp). */
const FILE_NAME_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|css|js|json|pdf|mp4|webm|woff2?|ttf)$/i

/** Placeholders copied from website templates and docs (you@yourcompany.com, user@domain.com, john@mail.com). */
const PLACEHOLDER_DOMAIN_RE = /^(your-?company|my-?company|company|your-?domain|domain|your-?site|website|your-?website|e-?mail|mail)\.(com|net|org)$/i

/** Error-tracking and site-builder system addresses (Sentry DSNs, Wix): never a person. */
const SYSTEM_DOMAIN_RE = /(^|\.)(ingest\.sentry\.io|wixpress\.com)$/i

/** A long hex local part is a key or a hash (Sentry DSN), not a mailbox. */
const TOKEN_LOCAL_RE = /^[0-9a-f]{16,}$/i

/** Data-protection authorities that postings cite for complaints; never the employer. */
const REGULATOR_DOMAIN_RE =
  /(^|\.)(dataprotection\.ie|ico\.org\.uk|cnil\.fr|bfdi\.bund\.de|aepd\.es|garanteprivacy\.it|gpdp\.it|autoriteitpersoonsgegevens\.nl|cnpd\.(pt|lu)|datatilsynet\.(no|dk)|imy\.se|uodo\.gov\.pl|edpb\.europa\.eu|edps\.europa\.eu)$/i

/** Why an address is a placeholder or a system address rather than a real mailbox, or null. */
function placeholderReason(email: string): string | null {
  const [local = '', domain = ''] = email.toLowerCase().split('@')
  if (PLACEHOLDER_DOMAIN_RE.test(domain)) return 'a placeholder address from a website template'
  if (SYSTEM_DOMAIN_RE.test(domain) || TOKEN_LOCAL_RE.test(local)) return 'a system address (error tracking or site builder)'
  if (REGULATOR_DOMAIN_RE.test(domain)) return 'the data-protection authority, not the employer'
  return null
}

/** Job boards, aggregators and ATS vendors: their addresses appear in listings but are never the employer. */
const JOB_BOARD_DOMAIN_RE =
  /(^|\.)(themuse|linkedin|indeed|glassdoor|jooble|adzuna|arbeitnow|landing\.jobs|himalayas|remoteok|jobicy|workingnomads|remotive|europa\.eu|stepstone|monster|xing|irishjobs|jobs\.ie|reed\.co\.uk|totaljobs|welcometothejungle|otta|wellfound|jobgether|greenhouse|lever|ashbyhq|workable|smartrecruiters|recruitee|personio|teamtailor|workday|myworkdayjobs|bamboohr|icims|jobvite|join\.com|francetravail|rapidapi)\./i

export function isJobBoardAddress(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return JOB_BOARD_DOMAIN_RE.test(`.${domain}`)
}

const FREE_MAIL_RE = /@(gmail|yahoo|hotmail|outlook|live|icloud|proton|gmx|web\.de|mail\.com|yandex)\./i

/** Reserved / documentation domains (demo data uses them): mail to them must never leave the app. */
const RESERVED_DOMAIN_RE = /(\.example|\.invalid|\.test|\.localhost|\.local|^example\.(com|net|org))$/i

export function isReservedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return !domain || RESERVED_DOMAIN_RE.test(domain) || RESERVED_DOMAIN_RE.test(`.${domain}`)
}

export function isUsableContact(email: string | null | undefined): boolean {
  return unusableContactReason(email) === null
}

/** Why an address cannot receive an application, or null when it can. */
export function unusableContactReason(email: string | null | undefined): string | null {
  if (!email) return 'no recipient address'
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || FILE_NAME_RE.test(email)) return 'not a valid email address'
  if (isReservedDomain(email)) return `"${email}" is a reserved test domain; nothing can be sent there`
  const placeholder = placeholderReason(email)
  if (placeholder) return `"${email}" is ${placeholder}`
  if (isJobBoardAddress(email)) return `"${email}" belongs to a job board, not the employer`
  const local = email.split('@')[0] ?? ''
  const m = UNUSABLE_LOCAL_RE.exec(local)
  if (m) return `"${email}" looks like a ${m[1].replace(/@$/, '')} mailbox, not a recruiting address`
  return null
}

export function isFreeMailAddress(email: string): boolean {
  return FREE_MAIL_RE.test(email)
}

/** Mailboxes meant for applications (careers@, jobs@, talent@, bewerbung@, people@...). */
const RECRUITING_LOCAL_RE =
  /(career|job|recruit|talent|^hr$|^hr[._-]|[._-]hr$|people|hiring|^hire|apply|applicat|^join|joinus|workwithus|^work$|bewerb|karriere|candidat|staffing|^ta$|talentacq|vacanc|resume|^cv$|stellen|emploi|recrut|lavora|trabaj|werken|vagas|personal(abteilung)?$)/i

/** General mailboxes: acceptable when a company publishes nothing better (common for small companies). */
const GENERAL_LOCAL_RE = /^(hello|hi|hey|contact|contactus|contact-us|info|office|team|mail|general|enquiries|inquiries|kontakt|bonjour|hallo|welcome|hola|ciao)$/i

/** firstname.lastname style: a person, e.g. the recruiter named in the posting. */
const PERSON_LOCAL_RE = /^[a-z]{2,}([._-][a-z]{2,}){0,2}$/i

/**
 * Automatic sends only go to mailboxes meant for applications: recruiting addresses, a general
 * contact address, or a person the posting itself names. Anything else found on a website
 * (officials@, import@, b2b@, ir@...) is held for you. Returns the reason, or null when fine.
 */
export function mailboxPurposeReason(email: string, source: string | null | undefined): string | null {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/\+.*$/, '')
  if (RECRUITING_LOCAL_RE.test(local) || GENERAL_LOCAL_RE.test(local)) return null
  if (PERSON_LOCAL_RE.test(local) && (source === 'posting' || source === 'manual')) return null
  return `"${email}" does not look like a mailbox for job applications`
}

/** Everything an automatic send checks about the recipient: the company's own domain and a fitting mailbox. */
export function autoSendRecipientProblem(email: string, company: { name: string; domain: string | null }, source: string | null | undefined): string | null {
  return companyMismatchReason(email, company) ?? mailboxPurposeReason(email, source)
}

/** Two-label public suffixes, so careers@acme.co.uk compares as acme.co.uk. */
const TWO_LEVEL_SUFFIX_RE = /\.(co|com|org|net|ac|gov|ltd|plc)\.[a-z]{2}$/i

export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  const parts = h.split('.')
  const keep = TWO_LEVEL_SUFFIX_RE.test(h) ? 3 : 2
  return parts.slice(-keep).join('.')
}

const GENERIC_NAME_WORDS = new Set(['group', 'holding', 'holdings', 'partners', 'solutions', 'services', 'technologies', 'technology', 'international', 'global', 'labs', 'company', 'enterprises', 'systems', 'software', 'digital', 'the', 'and'])

/**
 * Automatic sends only go to the company's own mailboxes: the address must be on the company's
 * domain, or its domain must contain the company's name (careers@wolt.com for "Wolt Enterprises Oy").
 * Personal mailboxes (gmail, protonmail...) and other companies' domains are held for you.
 * Returns why the address does not belong to the company, or null when it does.
 */
export function companyMismatchReason(email: string, company: { name: string; domain: string | null }): string | null {
  const domain = (email.split('@')[1] ?? '').toLowerCase()
  if (!domain) return 'no domain'
  if (isFreeMailAddress(email)) return `"${email}" is a personal mailbox, not ${company.name}'s`
  const reg = registrableDomain(domain)
  if (company.domain && reg === registrableDomain(company.domain)) return null
  const label = reg.split('.')[0].replace(/[^a-z0-9]/g, '')
  const words = company.name
    .toLowerCase()
    .replace(/\b(inc|ltd|limited|llc|gmbh|ag|bv|b\.v\.|sa|sas|plc|corp|oy|ab|as|aps|srl|spa|se|co)\b\.?/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC_NAME_WORDS.has(w))
  const compact = words.join('')
  if (compact.length >= 3 && (label.includes(compact) || (label.length >= 4 && compact.includes(label)))) return null
  if (words.some((w) => w.length >= 4 && label.includes(w))) return null
  return `"${email}" is not on ${company.name}'s domain${company.domain ? ` (${company.domain})` : ''}`
}
