/** Text helpers for matching questions and options (pure, unit-tested). */

export function normalizeQuestion(label: string): string {
  return label
    .toLowerCase()
    .replace(/[*✱]/g, ' ')
    .replace(/\((required|optional)\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'you', 'your', 'are', 'is', 'do', 'please', 'with', 'at', 'this', 'that', 'be', 'we', 'our', 'will'])

export function tokens(s: string): string[] {
  return normalizeQuestion(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t))
}

/** Jaccard similarity of word sets (0..1). */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a))
  const B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * Pick the option that best matches the wanted answer: exact, then case/space-insensitive,
 * then prefix/containment, then word overlap. Returns null when nothing is close enough.
 */
export function matchOption(wanted: string, options: string[]): string | null {
  if (!wanted || options.length === 0) return null
  const w = normalizeQuestion(wanted)
  if (!w) return null
  const exact = options.find((o) => o === wanted)
  if (exact) return exact
  const norm = options.map((o) => ({ o, n: normalizeQuestion(o) }))
  const same = norm.find((x) => x.n === w)
  if (same) return same.o
  // "Yes" must not match "Yes, but…" ahead of a plain "Yes"; prefer the shortest containing option.
  const starts = norm.filter((x) => x.n.startsWith(`${w} `) || w.startsWith(`${x.n} `)).sort((a, b) => a.n.length - b.n.length)
  if (starts.length && (w.length >= 3 || starts[0].n.split(' ')[0] === w)) return starts[0].o
  // Only from the start of a word: "Male" is inside "Female", which is the other answer.
  const contains = norm.filter((x) => ` ${x.n}`.includes(` ${w}`) || (x.n.length >= 4 && ` ${w}`.includes(` ${x.n}`))).sort((a, b) => a.n.length - b.n.length)
  if (contains.length && w.length >= 3) return contains[0].o
  let best: { o: string; s: number } | null = null
  for (const x of norm) {
    // A prefix that flips the meaning is no near miss: female/male, woman/man, unable/able.
    if (x.n !== w && (x.n.endsWith(w) || w.endsWith(x.n))) continue
    const s = similarity(w, x.n)
    if (!best || s > best.s) best = { o: x.o, s }
  }
  return best && best.s >= 0.5 ? best.o : null
}

/** Option that means "prefer not to say" in diversity questions. */
export function declineOption(options: string[]): string | null {
  const re = /(decline|prefer not|don.?t wish|do not wish|not (to )?(say|disclose|answer|self.?identify)|rather not|choose not|i do not want to answer|keine angabe|ne souhaite pas|wish to not)/i
  return options.find((o) => re.test(o)) ?? null
}

/** Range option ("3-5 years", "5+ years", "More than 6") that contains n. */
export function rangeOption(n: number, options: string[]): string | null {
  let best: string | null = null
  for (const o of options) {
    const nums = (o.match(/\d+(\.\d+)?/g) ?? []).map(Number)
    if (nums.length === 0) continue
    const lower = o.toLowerCase()
    if (nums.length >= 2) {
      if (n >= nums[0] && n <= nums[1]) return o
      continue
    }
    const v = nums[0]
    if (/\+|more than|over|at least|or more|above|plus/.test(lower) && n >= v) best = o
    else if (/less than|under|below|fewer/.test(lower) && n < v) best = best ?? o
    else if (Math.floor(n) === v) return o
  }
  return best
}

export function yesNo(options: string[], yes: boolean): string | null {
  // A letter after the word means it is not the word; \b is ASCII-only, so "Sí" never matched (Aistech Space).
  const re = yes ? /^(yes|ja|oui|si|sí|sim|tak|kyllä|igen|da|y)(?!\p{L})/iu : /^(no|nein|non|não|nao|nej|nee|ne|nie|ei|nem|n)(?!\p{L})/iu
  return options.find((o) => re.test(o.trim())) ?? null
}

/** Split "Alex Rivera Costa" into first/last; the last word is the family name. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
