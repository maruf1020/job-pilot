/** Matching an inbox message to the application it is about (pure, unit-tested). */

export const ATS_SENDER_RE =
  /(greenhouse(-mail)?\.io|lever\.co|ashbyhq\.com|myworkday(jobs)?\.com|workday\.com|smartrecruiters\.com|workablemail\.com|workable\.com|recruitee\.com|teamtailor(-mail)?\.com|personio\.(de|com)|jobvite\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|bamboohr\.com|join\.com|breezy\.hr|pinpointhq\.com|rippling\.com|dover\.com|comeet\.(co|com)|hibob\.com|eightfold\.ai|avature\.net|phenom(people)?\.com|homerun\.co)/i

/** Gmail search terms for ATS senders. */
export const ATS_SENDER_QUERY = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'ashbyhq.com',
  'homerun.co',
  'myworkday.com',
  'smartrecruiters.com',
  'workablemail.com',
  'recruitee.com',
  'teamtailor.com',
  'teamtailor-mail.com',
  'personio.de',
  'jobvite.com',
  'icims.com',
]

const NOISE_RE =
  /(job alert|new jobs|jobs for you|recommended jobs|jobs you might|newsletter|webinar|unsubscribe from (job|these) alerts|talent community digest|weekly digest|your invoice|invoice is (ready|available)|receipt for|payment (received|failed|confirmation)|your order|order confirmation|password reset|reset your password|security alert|new sign-?in|verify your (email|account)|verification code|your subscription|trial (ends|expired)|usage (report|summary)|billing statement|statement is (ready|available))/i

/** Senders that only send notifications; a real reply about an application never comes from them. */
const NOTIFICATION_SENDER_RE = /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|notify|alerts?|billing|invoices?|receipts?|payments?|accounts?|system)[@+._-]/i

/** Words a message about a job application almost always contains. */
const APPLICATION_CONTEXT_RE = /(applicat|applied|applying|candidate|candidacy|position|vacancy|role|job|interview|recruit|hiring|talent|career|cv\b|resume|curriculum|bewerbung|candidature|sollicitatie|stelle)/i

export function fromAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m ? m[1] : from).trim().toLowerCase()
}

export function fromDomain(from: string): string {
  return fromAddress(from).split('@')[1] ?? ''
}

const SUFFIX_RE = /\b(inc|ltd|limited|llc|gmbh|ag|bv|b\.v|sa|sas|plc|corp|corporation|co|company|group|holding|holdings|se|oy|ab|as|aps|srl|spa|technologies|technology|labs)\b\.?/gi

export function companyKey(name: string): string {
  return name.toLowerCase().replace(SUFFIX_RE, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

const GENERIC_RE = /\b(enterprises?|solutions|systems|software|services|international|global|digital|europe|european|technologies|consulting|partners|ventures|studios?)\b/g

/** Ways a company is named in mail: "wolt enterprises", then the distinctive "wolt". */
export function companyKeys(name: string): Array<{ key: string; strong: boolean }> {
  const full = companyKey(name)
  const core = full.replace(GENERIC_RE, ' ').replace(/\s+/g, ' ').trim()
  const first = core.split(' ')[0] ?? ''
  const out: Array<{ key: string; strong: boolean }> = []
  if (full) out.push({ key: full, strong: true })
  if (core && core !== full) out.push({ key: core, strong: true })
  if (first.length >= 4 && first !== core) out.push({ key: first, strong: false })
  return out
}

export interface InboxMessageLite {
  from: string
  subject: string
  text: string
  date: Date | null
}

export interface ApplicationRef {
  id: string
  sentAt: Date
  title: string
  company: string
  domain: string | null
}

function containsWord(hay: string, needle: string): boolean {
  if (!needle || needle.length < 2) return false
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(hay)
}

const TITLE_STOP = new Set(['senior', 'junior', 'lead', 'staff', 'principal', 'engineer', 'developer', 'software', 'the', 'and', 'for', 'with', 'm/f/d', 'w/m/d', 'remote', 'hybrid'])

export function isNoise(msg: InboxMessageLite): boolean {
  if (NOISE_RE.test(`${msg.subject}\n${msg.text.slice(0, 800)}`)) return true
  // A notification mailbox (noreply@, billing@...) counts only when the message is clearly about an application.
  const local = fromAddress(msg.from).split('@')[0] ?? ''
  if (NOTIFICATION_SENDER_RE.test(`${local}@`) && !ATS_SENDER_RE.test(fromDomain(msg.from)) && !APPLICATION_CONTEXT_RE.test(`${msg.subject}\n${msg.text.slice(0, 1500)}`)) return true
  return false
}

/**
 * Score each application against the message and return the clear winner, or null.
 * Strong signals: the sender's domain is the company's, or the company name appears in the
 * sender/subject. The message must arrive after the application was sent.
 */
export function matchApplication(msg: InboxMessageLite, apps: ApplicationRef[]): { id: string; score: number } | null {
  if (isNoise(msg)) return null
  const domain = fromDomain(msg.from)
  const display = msg.from.replace(/<[^>]+>/, ' ')
  const head = `${display}\n${msg.subject}`
  const body = msg.text.slice(0, 2500)
  const viaAts = ATS_SENDER_RE.test(domain)
  const scored: Array<{ id: string; score: number }> = []
  for (const a of apps) {
    if (msg.date && msg.date.getTime() < a.sentAt.getTime() - 3_600_000) continue
    let s = 0
    if (a.domain && domain && (domain === a.domain || domain.endsWith(`.${a.domain}`))) s += 6
    const keys = companyKeys(a.company)
    const inHead = keys.find((k) => containsWord(head, k.key))
    const inBody = inHead ? undefined : keys.find((k) => containsWord(body, k.key))
    if (inHead) s += inHead.strong ? 4 : 3
    else if (inBody) s += viaAts ? 3 : 2
    const titleWords = a.title
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((w) => w.length > 2 && !TITLE_STOP.has(w))
    if (titleWords.length && titleWords.every((w) => containsWord(`${head}\n${body}`, w))) s += 2
    if (viaAts && s > 0) s += 1
    if (s > 0) scored.push({ id: a.id, score: s })
  }
  scored.sort((x, y) => y.score - x.score)
  const best = scored[0]
  if (!best || best.score < 5) return null
  // Two applications to the same company: the title must decide, otherwise skip.
  if (scored[1] && scored[1].score === best.score) return null
  return best
}

/** Security-code / verification emails belong to the apply flow, not to the application history. */
export function isVerificationMail(msg: InboxMessageLite): boolean {
  return /(security code|verification code|verify your (email|account)|confirm your (email|account)|one-time (code|password)|activate your account)/i.test(`${msg.subject}\n${msg.text.slice(0, 600)}`)
}
