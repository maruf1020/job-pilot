const LEGAL_SUFFIXES = [
  'ltd',
  'limited',
  'gmbh',
  'inc',
  'incorporated',
  'llc',
  'bv',
  'b.v',
  'nv',
  'n.v',
  'ag',
  'sa',
  's.a',
  'plc',
  'oy',
  'oyj',
  'ab',
  'as',
  'a/s',
  'aps',
  'sarl',
  'sàrl',
  'srl',
  's.r.l',
  's.r.o',
  'sp. z o.o',
  'sp z o o',
  'corp',
  'corporation',
  'co',
  'company',
  'group',
  'holdings',
  'technologies',
  'technology',
  'labs',
  'ug',
  'kg',
  'se',
  'dac',
  'unlimited',
]

const suffixRe = new RegExp(`\\b(${LEGAL_SUFFIXES.map(escape).join('|')})\\.?$`, 'i')

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeCompany(name: string): string {
  let s = name.toLowerCase().trim()
  s = s.replace(/&/g, ' and ')
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // strip up to two trailing legal suffixes ("Acme Technologies Ltd")
  for (let i = 0; i < 2; i++) {
    const next = s.replace(suffixRe, '').trim()
    if (next === s || next.length < 2) break
    s = next
  }
  return s.replace(/\./g, '').replace(/\s+/g, ' ').trim()
}

const GENDER_TAGS = /\((?:m|w|f|d|x|h|a|all genders|gn|any)(?:\s*\/\s*(?:m|w|f|d|x|h|a|gn|any))*\)/gi

export function normalizeTitle(title: string): string {
  let s = title.toLowerCase()
  s = s.replace(GENDER_TAGS, ' ')
  s = s.replace(/\b(m\/f\/d|w\/m\/d|f\/m\/x|m\/w\/d|f\/m\/d|all genders)\b/g, ' ')
  s = s.replace(/[^\p{L}\p{N}\s+#.]/gu, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&hellip;': '...',
  '&mdash;': '-',
  '&ndash;': '-',
  '&rsquo;': "'",
  '&lsquo;': "'",
  '&rdquo;': '"',
  '&ldquo;': '"',
  '&euro;': '€',
  '&pound;': '£',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|#160|hellip|mdash|ndash|rsquo|lsquo|rdquo|ldquo|euro|pound);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
}

/** Convert HTML to readable plain text (paragraph/list aware). */
export function htmlToText(html: string): string {
  if (!html) return ''
  let s = html
  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|article|ul|ol|blockquote)\s*>/gi, '\n')
  s = s.replace(/<\s*li[^>]*>/gi, '- ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/[ \t\f\v]+/g, ' ')
  s = s.replace(/ *\n */g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s)
}

export function toPlainText(s: string): string {
  // Some feeds escape their HTML once more ("&lt;p&gt;"); unescape that layer first so the tags go too.
  const raw = !looksLikeHtml(s) && /&lt;\/?[a-z][\s\S]*?&gt;/i.test(s) ? decodeEntities(s) : s
  return looksLikeHtml(raw) ? htmlToText(raw) : decodeEntities(raw).replace(/\r\n?/g, '\n').trim()
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…'
}

export function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|noreply|donotreply|privacy|dpo|gdpr|legal|press|abuse|postmaster|support|help|info@example)/i
const JUNK_DOMAINS = /(example\.com|sentry\.io|wixpress|w3\.org|schema\.org|googleapis|gstatic)$/i

/** Extract plausible application/contact emails from a description. */
export function extractEmails(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/\.+$/, '')
    const [local, domain] = e.split('@')
    if (!local || !domain) continue
    if (JUNK_LOCAL.test(local)) continue
    if (JUNK_DOMAINS.test(domain)) continue
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(domain)) continue
    found.add(e)
  }
  // Prefer recruiting-style addresses first
  return [...found].sort((a, b) => scoreEmail(b) - scoreEmail(a))
}

function scoreEmail(e: string): number {
  const local = e.split('@')[0]
  if (/^(jobs|careers|career|recruit|recruiting|recruitment|talent|hiring|hr|people|apply|applications?)/i.test(local)) return 3
  if (/(jobs|careers|recruit|talent|hiring|hr|apply)/i.test(local)) return 2
  return 1
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

export function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? fullName
}
