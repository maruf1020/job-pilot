import { needsSponsorshipFor, type CandidateContext } from '@/lib/candidate/context'
import { JUNIOR_TITLE_WORDS, normalizeSeniority, professionDictionary } from '@/lib/candidate/professions'
import { OUTSIDE_EUROPE_TARGETS, type OutsideEuropeTarget } from '@/lib/regions'
import { DEFAULT_RANKING, DEFAULT_SEARCH, type AppSettings, type RankingWeights } from './schema'
import type { SettingsPatch } from './service'

/** Where-to-look answers from onboarding (step "Where to look"). */
export interface ProfilePrefs {
  countries?: string[]
  priorityTiers?: string[][]
  includeRemote?: boolean
  remoteOnly?: boolean
  minSalaryEur?: number | null
}

/** Search queries kept per run at most; the rotation adds variants from the profile on top. */
const MAX_QUERIES = 12
/** Skills copied to the ranking keywords. */
const MAX_KEYWORDS = 15
/** Programming languages and frameworks: for a developer, these decide whether a batch job is in the stack. */
const STACK_SKILL_RE = /^(javascript|typescript|react(\.js)?|node(\.js)?|next\.?js|nestjs|vue(\.js)?|angular|java|spring( boot)?|kotlin|scala|python|django|flask|fastapi|go|golang|ruby|rails|ruby on rails|php|laravel|symfony|c#|\.net|asp\.net|rust|elixir|c\+\+|swift|objective-c|flutter|dart|svelte)$/i
/** Weights that only make sense for a person who needs a visa somewhere they search. */
const SPONSORSHIP_WEIGHTS = ['sponsorshipYes', 'sponsorshipLikely', 'knownSponsor', 'salaryBelowCsep'] as const

const uniq = (xs: string[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const t = x.trim()
    const k = t.toLowerCase().replace(/\s+/g, ' ')
    if (!t || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

const isCountryCode = (c: string) => /^[A-Z]{2}$/.test(c)

/**
 * Settings that follow from the profile: what to search for (queries, profession, target titles,
 * title words to drop), how to rank (skills, levels, salary floor, sponsorship weights) and where
 * to look (countries, tiers, remote). Pure, so it can be tested; the caller writes it with
 * updateSettings, which merges it into the current settings.
 */
export function deriveSettingsFromProfile(ctx: CandidateContext, prefs: ProfilePrefs = {}): SettingsPatch {
  const dict = professionDictionary(ctx.profession)
  const titles = uniq(ctx.titles)

  // Queries: the person's own titles first, then the field's usual ones when there are few.
  const queries = uniq([...titles.map((t) => t.toLowerCase()), ...(titles.length < 3 ? dict.queries : [])]).slice(0, MAX_QUERIES)

  // Title words to drop: other trades of the field, skills the person avoids, and junior titles
  // unless the person looks for junior roles. A word that is part of a target title is never dropped.
  const seniority = normalizeSeniority(ctx.seniority)
  const juniorOk = !seniority.length || seniority.includes('junior')
  const targetText = titles.join(' ').toLowerCase()
  const exclude = uniq([...dict.excludeTitleWords, ...(juniorOk ? [] : JUNIOR_TITLE_WORDS), ...ctx.stopSkills.map((s) => s.toLowerCase())]).filter((w) => !targetText.includes(w.toLowerCase()))

  const stop = new Set(ctx.stopSkills.map((s) => s.toLowerCase()))
  const skills = uniq(ctx.skills).filter((s) => !stop.has(s.toLowerCase()))
  const keywords = (skills.length ? skills : dict.skills).slice(0, MAX_KEYWORDS).map((s) => s.toLowerCase())
  const stackFocus = ctx.profession === 'software' ? skills.filter((s) => STACK_SKILL_RE.test(s.trim())).map((s) => s.toLowerCase()) : []

  // Where to look.
  const picked = uniq((prefs.countries ?? []).map((c) => c.toUpperCase())).filter(isCountryCode)
  const countries = picked.length ? picked : [...DEFAULT_SEARCH.countries]
  const tiers = (prefs.priorityTiers ?? []).map((t) => uniq(t.map((c) => c.toUpperCase())).filter(isCountryCode)).filter((t) => t.length)
  const outsideEurope = countries.filter((c): c is OutsideEuropeTarget => (OUTSIDE_EUROPE_TARGETS as readonly string[]).includes(c))
  const remoteOnly = prefs.remoteOnly ?? ctx.remote === 'only'
  const includeRemote = remoteOnly || (prefs.includeRemote ?? ctx.remote !== 'no')

  // Sponsorship weights count only when the person needs a visa in at least one searched country
  // (or has not said): an EU citizen searching the EU gets no points for "visa sponsorship offered".
  const searched = [...countries, ...(picked.length && !picked.includes('GB') ? [] : ['GB'])]
  const needsSomewhere = searched.some((c) => needsSponsorshipFor(ctx, c) !== false)
  const weights: Partial<RankingWeights> = {}
  for (const k of SPONSORSHIP_WEIGHTS) weights[k] = needsSomewhere ? DEFAULT_RANKING.weights[k] : 0

  const patch: SettingsPatch = {
    search: {
      queries,
      profession: ctx.profession,
      targetTitles: titles,
      excludeTitleKeywords: exclude,
      countries,
      priorityTiers: tiers,
      outsideEurope,
      includeUk: picked.length ? picked.includes('GB') : DEFAULT_SEARCH.includeUk,
      includeRemote,
      remoteOnly,
    },
    ranking: {
      stackKeywords: keywords,
      minSalaryEur: prefs.minSalaryEur && prefs.minSalaryEur > 0 ? Math.round(prefs.minSalaryEur) : null,
      // Merged into the stored weights by updateSettings; only these keys change.
      weights: weights as RankingWeights,
    },
    portal: {
      targetTitlesOnly: ctx.profession !== 'other' || titles.length > 0,
      seniority,
      stackFocus,
    },
    email: {
      // The permit gate (sponsor evidence, salary floors) only helps a person who needs a permit.
      eligibilityGate: needsSomewhere,
    },
  }
  if (ctx.timezone && isTimeZone(ctx.timezone)) patch.general = { timezone: ctx.timezone }
  return patch
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Builds Settings from the saved profile and the where-to-look answers, and stores them. Called by
 * onboarding when the form is finished (and may be called again after a profile edit).
 */
export async function applyProfileToSettings(prefs: ProfilePrefs = {}): Promise<AppSettings> {
  const [{ loadCandidateContext }, { updateSettings }] = await Promise.all([import('@/lib/candidate/load'), import('./service')])
  const ctx = await loadCandidateContext({ fresh: true })
  return updateSettings(deriveSettingsFromProfile(ctx, prefs))
}
