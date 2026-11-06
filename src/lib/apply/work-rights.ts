import { FREE_MOVEMENT, hasRightToWork, type CandidateContext } from '@/lib/candidate/context'

/**
 * Right-to-work truth checks for answers written by a model (form driver, second look) and for the rule
 * answers: what the person may claim depends on the job's country and the profile, never on code.
 */

const WORK_RIGHTS = /eligib|authori[sz]|right to work|work permit|visa|sponsor|legally|berechtigt|arbeitserlaubnis/i
/** "authorised to work ... without (requiring) sponsorship": an authorisation question, not a sponsorship one. */
const WITHOUT_SPONSORSHIP = /without (requiring |needing |the need for |future |any |current or future )?(visa |employer |company |employment )?sponsor/i
const ASKS_SPONSORSHIP = /(require|need|will you need).{0,60}(sponsor|visa)/i
const ASKS_AUTHORISED = /(authori[sz]ed|eligible|entitled|permitted|right|legally).{0,40}(work|employ)|berechtigt/i
const YES_RE = /^(yes|ja|oui|si|sí|sim|tak)(?!\p{L})/iu
const NO_RE = /^(no|nein|non|não|nao|nee|nej|nie)(?!\p{L})/iu
/** An answer that says no sponsorship is needed. */
const DENIES_NEED = /do not (need|require)|don.?t (need|require)|not (need|require)|without (visa |any )?sponsorship|no sponsorship/i
/** An answer that claims a right, a residency or a visa. */
const CLAIMS_ANY_RIGHT = /citizen|resident|settled|indefinite|i (already |currently )?(have|hold)/i

/**
 * Options that claim a right ("I am an Irish Citizen", "permanent resident", "I do not need sponsorship").
 * For someone without the right to work in the job's country every one of them is false.
 */
export const CLAIMS_RIGHT = /\b(i am an? [\w ]{0,20}citizen|citizen of|(eu|irish|uk|british|german|dutch|french|spanish|us|american|canadian) (citizen|national|passport)|permanent resident|settled status|i (already )?(have|hold) (the )?(right to work|work permit|visa)|(do not|don.?t) (need|require) (visa )?sponsorship|no sponsorship (needed|required))/i

/** Words a citizenship of this country may be written with ("Portugal" -> "portu", "GB" -> "british"). */
function citizenshipWords(ctx: Pick<CandidateContext, 'citizenships' | 'citizenshipNames'>): string[] {
  const words = ctx.citizenshipNames.map((n) => n.toLowerCase().slice(0, Math.min(5, n.length)))
  for (const c of ctx.citizenships) {
    if (c === 'GB' || c === 'UK') words.push('british', 'uk', 'united kingdom')
    if (c === 'US') words.push('american', 'us', 'united states', 'u.s')
    if (c === 'NL') words.push('dutch')
    if (FREE_MOVEMENT.has(c) && !['CH', 'NO', 'IS', 'LI'].includes(c)) words.push('eu', 'european')
    if (FREE_MOVEMENT.has(c)) words.push('eea')
  }
  return words
}

const GENERIC_BEFORE_CITIZEN = new Set(['a', 'an', 'the', 'am', 'be', 'i', 'local', 'country', 'national', 'dual', 'or'])

/**
 * Whether an answer claims a right the person does not have. Someone with no (or an unknown) right to work
 * in the job's country may claim none. Someone with it may still not claim another country's citizenship
 * ("I am an Irish Citizen" from a Portuguese citizen working in Ireland under EU free movement).
 */
export function claimsFalseRight(text: string, ctx: Pick<CandidateContext, 'citizenships' | 'citizenshipNames' | 'workAuth'>, countryCode: string | null | undefined): boolean {
  const right = hasRightToWork(ctx, countryCode)
  if (right !== true) return CLAIMS_RIGHT.test(text)
  const own = citizenshipWords(ctx)
  const t = text.toLowerCase()
  const named = [...t.matchAll(/\b([a-z.]+)\s+(citizen|national|passport)/g)].map((m) => m[1]).filter((w) => !GENERIC_BEFORE_CITIZEN.has(w))
  const of = [...t.matchAll(/citizen of (?:the )?([a-z ]{3,30})/g)].map((m) => m[1].trim())
  return [...named, ...of].some((w) => !own.some((o) => w.startsWith(o) || o.startsWith(w)))
}

/**
 * Visa and right-to-work questions have one true answer for the job's country: with the right to work there,
 * "authorised: Yes / sponsorship: No"; without it, the opposite, never an option that claims a right or
 * residency. When the profile does not say, the AI may not answer them at all (they need the person).
 */
export function truthfulWorkAnswer(label: string, value: string, ctx: Pick<CandidateContext, 'citizenships' | 'citizenshipNames' | 'workAuth'>, countryCode: string | null | undefined): boolean {
  if (!WORK_RIGHTS.test(label)) return true
  const right = hasRightToWork(ctx, countryCode)
  if (right === null) return false
  const v = value.trim()
  const asksAuthorised = WITHOUT_SPONSORSHIP.test(label) || (!ASKS_SPONSORSHIP.test(label) && ASKS_AUTHORISED.test(label))
  const asksSponsorship = !asksAuthorised && ASKS_SPONSORSHIP.test(label)
  if (right === false) {
    if (CLAIMS_ANY_RIGHT.test(v) || DENIES_NEED.test(v)) return false
    if (asksSponsorship) return YES_RE.test(v) || /requir|need/i.test(v)
    if (asksAuthorised) return NO_RE.test(v)
    return true
  }
  if (claimsFalseRight(v, ctx, countryCode)) return false
  if (asksSponsorship) return NO_RE.test(v) || DENIES_NEED.test(v)
  if (asksAuthorised) return YES_RE.test(v) || /citizen|authori[sz]ed|right to work|eligible|resident/i.test(v)
  // A right-holder never claims to need a visa or permit ("I require a work permit").
  return !/(requir|need)\w*.{0,30}(sponsor|visa|permit)/i.test(v) || DENIES_NEED.test(v)
}
