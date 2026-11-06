import { escapeRegex } from '@/lib/geo'
import { DEFAULT_BANNED_PHRASES, type BannedPhraseSeed } from './banned-phrases'
import { autofixText } from './lint'

/**
 * Checks for text the agent types into application forms (AI answers, cover letters): the same
 * banned phrases and punctuation rules as the emails, plus the words the writing rules ban everywhere.
 * Plain swaps fix most hits without another AI call; what is left goes to one rewrite or to the person.
 */

/** Banned in every application text ("no passionate / excited / eager"), whatever Settings → AI lists. */
export const ALWAYS_BANNED: BannedPhraseSeed[] = [
  { phrase: 'eager', severity: 'error', category: 'cliche' },
  { phrase: 'eagerly', severity: 'error', category: 'cliche' },
  { phrase: 'excited', severity: 'error', category: 'cliche' },
  { phrase: 'exciting', severity: 'error', category: 'cliche' },
  { phrase: 'thrilled', severity: 'error', category: 'cliche' },
  { phrase: 'passionate', severity: 'error', category: 'cliche' },
  { phrase: 'dream company', severity: 'error', category: 'cliche' },
  { phrase: 'dream job', severity: 'error', category: 'cliche' },
]

/** Meaning-keeping replacements, longest phrases first. Case of the first letter is kept. */
const SWAPS: Array<[RegExp, string]> = [
  [/\beager to\b/gi, 'keen to'],
  [/\beagerly\b/gi, 'gladly'],
  [/\beager\b/gi, 'keen'],
  [/\bexcited about\b/gi, 'interested in'],
  [/\bexcited by\b/gi, 'drawn to'],
  [/\bexcited to\b/gi, 'glad to'],
  [/\bexcited\b/gi, 'glad'],
  [/\bexciting\b/gi, 'interesting'],
  [/\bthrilled to\b/gi, 'glad to'],
  [/\bthrilled\b/gi, 'glad'],
  [/\bpassionate about\b/gi, 'keen on'],
  [/\bpassion for\b/gi, 'interest in'],
  [/\bpassionate\b/gi, 'keen'],
  [/\bdream (company|job)\b/gi, 'a place I want to work'],
  [/\bleveraging\b/gi, 'using'],
  [/\bleveraged\b/gi, 'used'],
  [/\bleverage\b/gi, 'use'],
  [/\butili[sz]ing\b/gi, 'using'],
  [/\butili[sz]ed\b/gi, 'used'],
  [/\butili[sz]e\b/gi, 'use'],
  [/\bspearheaded\b/gi, 'led'],
  [/\bspearhead\b/gi, 'lead'],
  [/\brobust\b/gi, 'solid'],
  [/\bseamlessly\b/gi, 'smoothly'],
  [/\bseamless\b/gi, 'smooth'],
  [/\bcutting[- ]edge\b/gi, 'modern'],
  [/\binnovative\b/gi, 'new'],
  [/\bdelve\b/gi, 'dig'],
  [/\bempowering\b/gi, 'helping'],
  [/\bempower\b/gi, 'help'],
  [/\belevate\b/gi, 'improve'],
  [/\bharness\b/gi, 'use'],
  [/\bmeticulous\b/gi, 'careful'],
  [/\bpivotal\b/gi, 'key'],
  [/\brealm\b/gi, 'area'],
  [/\bholistic\b/gi, 'complete'],
  [/\bmultifaceted\b/gi, 'varied'],
  [/\bfast-paced\b/gi, 'busy'],
  [/\bever-evolving\b/gi, 'changing'],
  [/\b(perfect|best) fit\b/gi, 'strong fit'],
  [/\bthe ideal candidate\b/gi, 'a strong candidate'],
  [/\bideal candidate\b/gi, 'strong candidate'],
  [/\bthe right candidate\b/gi, 'a strong candidate'],
  [/\bteam player\b/gi, 'good teammate'],
  [/\bdetail-oriented\b/gi, 'careful'],
  [/\bresults-driven\b/gi, 'focused on results'],
  [/\bproven track record\b/gi, 'record'],
  [/\baligned with\b/gi, 'in line with'],
  [/\baligns with\b/gi, 'fits'],
  [/\balign with\b/gi, 'fit'],
  [/\bembark on\b/gi, 'start'],
  [/\bgame[- ]changer\b/gi, 'big step'],
  [/\bsynerg(y|ies)\b/gi, 'teamwork'],
  [/\btestament to\b/gi, 'proof of'],
  [/\blandscape\b/gi, 'market'],
  [/\bunlock\b/gi, 'open up'],
  [/\ba wealth of\b/gi, 'a lot of'],
  [/\bI am confident that\b/gi, "I'm sure"],
  [/(^|(?<=[.!?]\s))(additionally|furthermore|moreover),\s*/gim, 'Also, '],
  [/(^|(?<=[.!?]\s))in conclusion,\s*/gim, 'So, '],
]

const EMOJI_RE = /\p{Extended_Pictographic}️?/gu

function keepCase(original: string, replacement: string): string {
  if (!replacement) return replacement
  return /^[A-Z]/.test(original) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement
}

function phraseRegex(p: BannedPhraseSeed): RegExp {
  if (p.isRegex) return new RegExp(p.phrase, 'i')
  const t = p.phrase.trim()
  const start = /^\w/.test(t) ? '\\b' : ''
  const end = /\w$/.test(t) ? '\\b' : ''
  return new RegExp(`${start}${escapeRegex(t)}${end}`, 'i')
}

export interface FreeTextCheck {
  /** The text after punctuation fixes and word swaps. */
  text: string
  /** Banned phrases still in it (error severity only); empty = fine to submit. */
  problems: string[]
}

/** Punctuation fixes, safe word swaps, then the banned-phrase check. Deterministic, no AI. */
export function checkFreeText(input: string, phrases: BannedPhraseSeed[] = DEFAULT_BANNED_PHRASES): FreeTextCheck {
  let text = autofixText(input).replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ')
  for (const [re, rep] of SWAPS) text = text.replace(re, (m) => keepCase(m.trim(), rep))
  text = text.replace(/[ \t]{2,}/g, ' ').trim()
  const problems: string[] = []
  for (const p of [...phrases, ...ALWAYS_BANNED]) {
    if (p.severity !== 'error') continue
    // Placeholders such as "[company]" are left to the caller's own checks only when they are real text.
    const m = phraseRegex(p).exec(text)
    if (m && !problems.includes(m[0].trim().toLowerCase())) problems.push(m[0].trim().toLowerCase())
  }
  return { text, problems }
}
