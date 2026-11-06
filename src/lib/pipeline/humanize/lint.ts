import { escapeRegex } from '@/lib/geo'
import { lastName, splitParagraphs, splitSentences, stdDev, wordCount } from '@/lib/text'
import { DEFAULT_BANNED_PHRASES, type BannedPhraseSeed } from './banned-phrases'

export type LintSeverity = 'error' | 'warn'

export interface LintIssue {
  rule: string
  severity: LintSeverity
  message: string
  /** The offending text, when applicable. */
  match?: string
  /** Where: subject | body */
  where: 'subject' | 'body'
}

export interface LintStats {
  words: number
  sentences: number
  paragraphs: number
  avgSentenceLen: number
  sentenceLenStdDev: number
  subjectChars: number
}

export interface LintResult {
  passed: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
  stats: LintStats
  /** Body after deterministic autofixes (quotes, dashes, spacing). */
  fixedBody: string
  fixedSubject: string
}

export interface LintContext {
  companyName: string
  /** Skills the job asks for (from enrichment). Empty = rule skipped. */
  mustHaveSkills?: string[]
  /** Short, quotable facts/keywords from the profile ("team of 10", "HRMS", "NestJS"). */
  profileFacts?: string[]
  profileName: string
  /** Skills that must never be claimed. */
  stopSkills?: string[]
  bannedPhrases?: BannedPhraseSeed[]
  minWords?: number
  maxWords?: number
  /** Kind of email: initial application or short follow-up. */
  kind?: 'initial' | 'follow_up'
}

const CURLY: Array<[RegExp, string]> = [
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/…/g, '...'],
  [/ /g, ' '],
]

/**
 * Deterministic fixes that never change meaning: straight quotes, no em/en
 * dashes, no ellipsis character, single spaces, no exclamation marks.
 */
export function autofixText(text: string): string {
  let s = text
  for (const [re, rep] of CURLY) s = s.replace(re, rep)
  // " — " / " – " between clauses → comma
  s = s.replace(/\s+[—–]\s+/g, ', ')
  // word—word → word, word
  s = s.replace(/(\S)[—–](\S)/g, '$1, $2')
  s = s.replace(/[—–]/g, '-')
  // spaced hyphen used as a dash on one line: "foo - bar" → "foo, bar" (never across lines, keeps list markers intact)
  s = s.replace(/(\w)[ \t]+-[ \t]+(\w)/g, '$1, $2')
  s = s.replace(/!+/g, '.')
  s = s.replace(/\.{4,}/g, '...')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/ +\n/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  // ", ," or ",." cleanups produced by dash replacement
  s = s.replace(/,\s*,/g, ',').replace(/,\s*\./g, '.')
  return s.trim()
}

const EMOJI_RE = /\p{Extended_Pictographic}/u
const BULLET_LINE_RE = /^\s*([-*•▪◦]|\d+[.)])\s+/m
const HEADER_LINE_RE = /^\s*#{1,6}\s/m
const BOLD_RE = /\*\*[^*]+\*\*|__[^_]+__/
const URL_RE = /https?:\/\/\S+/i

function phraseRegex(p: BannedPhraseSeed): RegExp {
  if (p.isRegex) return new RegExp(p.phrase, 'i')
  const escaped = escapeRegex(p.phrase.trim())
  // word boundaries only when the phrase starts/ends with a word char
  const start = /^\w/.test(p.phrase) ? '\\b' : ''
  const end = /\w$/.test(p.phrase) ? '\\b' : ''
  return new RegExp(`${start}${escaped}${end}`, 'i')
}

function containsAny(haystackLower: string, needles: string[]): string | null {
  for (const n of needles) {
    const t = n.trim().toLowerCase()
    if (t.length < 2) continue
    if (haystackLower.includes(t)) return n
  }
  return null
}

const FACT_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'over', 'used', 'using', 'across', 'than', 'more', 'about', 'our', 'their', 'your', 'were', 'was', 'are', 'has', 'have', 'had', 'per', 'via'])

/**
 * A CV fact counts as used when most of its distinctive words appear in the text
 * ("leads a team of 10 engineers at Northwind Labs" <-> "I lead a team of 10 engineers").
 */
export function factMentioned(textLower: string, fact: string): boolean {
  const tokens = (fact.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []).filter((t) => (t.length >= 4 || /\d/.test(t)) && !FACT_STOPWORDS.has(t))
  if (tokens.length === 0) return textLower.includes(fact.toLowerCase())
  const present = tokens.filter((t) => new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`).test(textLower)).length
  const needed = Math.max(Math.min(2, tokens.length), Math.ceil(tokens.length * 0.5))
  return present >= needed
}

/**
 * Deterministic "does this read like a human wrote it" linter. Pure, < 1 ms.
 */
export function lintEmail(subject: string, body: string, ctx: LintContext): LintResult {
  const issues: LintIssue[] = []
  const add = (i: LintIssue) => issues.push(i)

  const fixedSubject = autofixText(subject).replace(/\n+/g, ' ')
  const fixedBody = autofixText(body)
  const bodyLower = fixedBody.toLowerCase()
  const subjectLower = fixedSubject.toLowerCase()
  const kind = ctx.kind ?? 'initial'

  const sentences = splitSentences(fixedBody)
  const paragraphs = splitParagraphs(fixedBody)
  const words = wordCount(fixedBody)
  const sentenceLens = sentences.map(wordCount)
  const stats: LintStats = {
    words,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    avgSentenceLen: sentenceLens.length ? sentenceLens.reduce((a, b) => a + b, 0) / sentenceLens.length : 0,
    sentenceLenStdDev: stdDev(sentenceLens),
    subjectChars: fixedSubject.length,
  }

  // --- banned phrases -------------------------------------------------------
  const phrases = ctx.bannedPhrases ?? DEFAULT_BANNED_PHRASES
  for (const p of phrases) {
    const re = phraseRegex(p)
    const mb = re.exec(fixedBody)
    if (mb) add({ rule: 'banned-phrase', severity: p.severity, message: `Avoid "${p.phrase.replace(/\\/g, '')}"`, match: mb[0].trim(), where: 'body' })
    const ms = re.exec(fixedSubject)
    if (ms) add({ rule: 'banned-phrase', severity: p.severity, message: `Avoid "${p.phrase.replace(/\\/g, '')}" in the subject`, match: ms[0].trim(), where: 'subject' })
  }

  // --- punctuation (post-autofix leftovers) ---------------------------------
  const punctuation: Array<[RegExp, string, LintSeverity]> = [
    [/[—–]/, 'Em/en dash', 'error'],
    [/[‘’“”]/, 'Curly quote', 'error'],
    [/…/, 'Ellipsis character', 'error'],
    [/!/, 'Exclamation mark', 'error'],
    [/ {2,}/, 'Double space', 'warn'],
    [/;/, 'Semicolon (split into two sentences)', 'warn'],
    [/:\s*$/m, 'Colon at end of line (reads like a list intro)', 'warn'],
  ]
  for (const [re, label, sev] of punctuation) {
    const m = re.exec(fixedBody)
    if (m) add({ rule: 'punctuation', severity: sev, message: label, match: m[0], where: 'body' })
  }
  if (EMOJI_RE.test(fixedBody) || EMOJI_RE.test(fixedSubject)) {
    add({ rule: 'punctuation', severity: 'error', message: 'Emoji', where: 'body' })
  }

  // --- structure ------------------------------------------------------------
  if (BULLET_LINE_RE.test(fixedBody)) add({ rule: 'structure', severity: 'error', message: 'Bullet or numbered list', where: 'body' })
  if (HEADER_LINE_RE.test(fixedBody)) add({ rule: 'structure', severity: 'error', message: 'Markdown header', where: 'body' })
  if (BOLD_RE.test(fixedBody)) add({ rule: 'structure', severity: 'error', message: 'Bold/markdown emphasis', where: 'body' })
  if (URL_RE.test(fixedBody)) add({ rule: 'structure', severity: 'warn', message: 'Raw URL in body (fine only for a portfolio link)', where: 'body' })
  // Greeting ("Hi Sarah,") and sign-off (the name) are not content paragraphs.
  const contentParagraphs = paragraphs.filter((p) => wordCount(p) > 6)
  const maxParagraphs = kind === 'follow_up' ? 2 : 4
  if (contentParagraphs.length > maxParagraphs) add({ rule: 'structure', severity: 'error', message: `More than ${maxParagraphs} paragraphs (${contentParagraphs.length})`, where: 'body' })
  if (contentParagraphs.length < 2 && kind === 'initial') add({ rule: 'structure', severity: 'warn', message: 'Single block of text, split into 2-4 short paragraphs', where: 'body' })
  for (const p of contentParagraphs) {
    const wc = wordCount(p)
    if (wc > 90) add({ rule: 'structure', severity: 'error', message: `Paragraph of ${wc} words (max 90)`, match: p.slice(0, 40) + '…', where: 'body' })
  }
  // three consecutive sentences of near-identical length reads machine-like
  for (let i = 0; i + 2 < sentenceLens.length; i++) {
    const [a, b, c] = [sentenceLens[i], sentenceLens[i + 1], sentenceLens[i + 2]]
    if (a >= 8 && Math.abs(a - b) <= 2 && Math.abs(b - c) <= 2 && Math.abs(a - c) <= 2) {
      add({ rule: 'rhythm', severity: 'warn', message: 'Three consecutive sentences of the same length', match: sentences[i + 1], where: 'body' })
      break
    }
  }
  if (sentences.length >= 5 && stats.sentenceLenStdDev < 3) {
    add({ rule: 'rhythm', severity: 'warn', message: 'Sentence lengths are too uniform', where: 'body' })
  }
  const thisStarts = sentences.filter((s) => /^this\b/i.test(s)).length
  if (thisStarts > 1) add({ rule: 'rhythm', severity: 'warn', message: 'More than one sentence starts with "This"', where: 'body' })
  const iStarts = sentences.filter((s) => /^i\b/i.test(s)).length
  if (sentences.length >= 4 && iStarts / sentences.length > 0.6) {
    add({ rule: 'rhythm', severity: 'warn', message: 'Most sentences start with "I"', where: 'body' })
  }
  if (/\?/.test(fixedBody)) {
    const qs = sentences.filter((s) => s.endsWith('?'))
    const rhetorical = qs.filter((q) => !/\b(would|could|can|are you|do you|is there|when)\b/i.test(q))
    if (rhetorical.length) add({ rule: 'rhythm', severity: 'warn', message: 'Rhetorical question', match: rhetorical[0], where: 'body' })
  }
  for (const s of sentences) {
    if (wordCount(s) > 35) add({ rule: 'rhythm', severity: 'warn', message: 'Very long sentence (>35 words)', match: s.slice(0, 60) + '…', where: 'body' })
  }

  // --- specificity ----------------------------------------------------------
  const company = ctx.companyName.trim()
  if (company && !bodyLower.includes(company.toLowerCase()) && !subjectLower.includes(company.toLowerCase())) {
    const firstToken = company.split(/\s+/)[0]?.toLowerCase()
    if (!firstToken || firstToken.length < 3 || !bodyLower.includes(firstToken)) {
      add({ rule: 'specificity', severity: 'error', message: `Company name "${company}" is not mentioned`, where: 'body' })
    }
  }
  // Emails are written in the first person: a draft once said "where he leads a team of 10 and still
  // writes", copied from a profile fact that has no subject.
  const thirdPerson = /\b(he|she) (leads|writes|built|builds|has|owns|owned|designed|runs|ran|shipped|still)\b|\bhis (team|work|code|own)\b/i.exec(fixedBody)
  if (thirdPerson) add({ rule: 'voice', severity: 'error', message: 'Talks about the candidate in the third person', match: thirdPerson[0], where: 'body' })
  // Hobbies and personal stories are not in the profile: a model once made one up to please an employer.
  const hobby = /\bi (enjoy|love|like) (painting|playing|collecting|cooking|hiking|gaming|knitting|drawing)\b|\bin my (free|spare) time\b|\bas a hobby\b|\bmy hobb(y|ies)\b/i.exec(fixedBody)
  if (hobby) add({ rule: 'facts', severity: 'error', message: 'A hobby or personal story that is not in the profile', match: hobby[0], where: 'body' })
  if (ctx.mustHaveSkills?.length) {
    const hit = containsAny(bodyLower, ctx.mustHaveSkills)
    if (!hit) add({ rule: 'specificity', severity: 'error', message: `None of the job's key skills mentioned (${ctx.mustHaveSkills.slice(0, 5).join(', ')})`, where: 'body' })
  }
  if (ctx.profileFacts?.length && kind === 'initial') {
    const hit = ctx.profileFacts.some((f) => factMentioned(bodyLower, f))
    if (!hit) add({ rule: 'specificity', severity: 'error', message: 'No concrete fact from the CV (name a project, a number, a team size)', where: 'body' })
  }
  const signName = lastName(ctx.profileName).toLowerCase()
  const tail = fixedBody.split('\n').slice(-6).join('\n').toLowerCase()
  if (signName && !tail.includes(signName) && !tail.includes(ctx.profileName.toLowerCase())) {
    add({ rule: 'specificity', severity: 'error', message: 'Missing sign-off with your name', where: 'body' })
  }

  // --- honesty --------------------------------------------------------------
  for (const s of ctx.stopSkills ?? []) {
    const t = s.trim()
    if (!t) continue
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`, 'i')
    if (re.test(fixedBody)) add({ rule: 'honesty', severity: 'error', message: `Claims "${t}", which is not on the profile`, match: t, where: 'body' })
  }

  // --- length ---------------------------------------------------------------
  const minWords = ctx.minWords ?? (kind === 'follow_up' ? 40 : 90)
  const maxWords = ctx.maxWords ?? (kind === 'follow_up' ? 120 : 220)
  if (words < minWords) add({ rule: 'length', severity: 'error', message: `Too short: ${words} words (min ${minWords})`, where: 'body' })
  if (words > maxWords) add({ rule: 'length', severity: 'error', message: `Too long: ${words} words (max ${maxWords})`, where: 'body' })
  if (fixedSubject.length > 70) add({ rule: 'length', severity: 'error', message: `Subject too long (${fixedSubject.length} chars, max 70)`, where: 'subject' })
  else if (fixedSubject.length > 60) add({ rule: 'length', severity: 'warn', message: `Subject a bit long (${fixedSubject.length} chars)`, where: 'subject' })
  if (fixedSubject.length < 12) add({ rule: 'length', severity: 'warn', message: 'Subject very short', where: 'subject' })
  if (/^application for\b/i.test(fixedSubject) || /^job application\b/i.test(fixedSubject)) {
    add({ rule: 'subject', severity: 'error', message: 'Subject starts with "Application for"', where: 'subject' })
  }
  if (/^re:/i.test(fixedSubject) && kind === 'initial') add({ rule: 'subject', severity: 'error', message: 'Fake "Re:" in subject', where: 'subject' })

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warn')
  return { passed: errors.length === 0, errors, warnings, stats, fixedBody, fixedSubject }
}

/** Compact text summary of lint issues for feeding back into the rewrite prompt. */
export function describeLintIssues(result: LintResult): string {
  const lines: string[] = []
  for (const e of result.errors) lines.push(`- [must fix] ${e.message}${e.match ? ` ("${e.match}")` : ''}`)
  for (const w of result.warnings.slice(0, 6)) lines.push(`- [should fix] ${w.message}${w.match ? ` ("${w.match}")` : ''}`)
  return lines.join('\n')
}
