import { isEuropeanCountry } from '@/lib/domain'
import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { fitsStack } from '@/lib/pipeline/prefilter'
import { isDevTitle, titleAllowed } from '@/lib/ranking/rules'

/**
 * How many jobs on a freshly found board would pass the person's rules. A board is only kept when at least one
 * does: a title in the person's field (target titles, profession, allowed levels), their skills in the title or
 * description, and a place in Europe or remote. The same checks the apply batches use.
 */

export interface BoardJobLike {
  title: string
  description?: string | null
  location?: string | null
  countryCode?: string | null
  remote?: boolean | null
}

export interface RelevanceRules {
  /** Settings -> Browser -> stack focus. Empty = any stack. */
  stackFocus: string[]
  /** Developer-title rule only: lead titles allowed (used when no profession is given). */
  allowLead: boolean
  /** Settings -> Search -> profession and target titles; when set, they decide the title instead of the developer rule. */
  profession?: string | null
  targetTitles?: string[]
  /** Settings -> Browser -> allowed levels (empty = any). */
  seniority?: string[]
}

/** Descriptions shorter than this are not judged on stack: many boards list a teaser, not the posting. */
const MIN_DESCRIPTION_FOR_STACK = 300

/**
 * Europe or remote. A job with a place counts when the place is European ("Remote - US" does not); without any
 * place it counts only when it is remote.
 */
export function inEuropeOrRemote(job: BoardJobLike): boolean {
  const place = (job.countryCode ?? guessCountry(job.location))?.toUpperCase()
  if (place) return isEuropeanCountry(place)
  return Boolean(job.remote) || isRemoteLocation(job.location)
}

export function jobMatchesRules(job: BoardJobLike, rules: RelevanceRules): boolean {
  if (rules.profession) {
    if (!titleAllowed({ targetTitlesOnly: true, seniority: rules.seniority }, job.title, { profession: rules.profession, targetTitles: rules.targetTitles })) return false
  } else if (!isDevTitle(job.title, { allowLead: rules.allowLead })) return false
  const description = job.description ?? ''
  if (description.length > MIN_DESCRIPTION_FOR_STACK && !fitsStack(job.title, description, rules.stackFocus)) return false
  return inEuropeOrRemote(job)
}

export interface BoardRelevance {
  /** Jobs the board listed (the engineering ones its adapter keeps). */
  total: number
  /** Jobs passing the rules. */
  matching: number
}

export function countMatchingJobs(jobs: BoardJobLike[], rules: RelevanceRules): BoardRelevance {
  let matching = 0
  for (const j of jobs) if (jobMatchesRules(j, rules)) matching++
  return { total: jobs.length, matching }
}

/** "3 matching jobs", "1 matching job", "no matching jobs (12 listed)". */
export function describeRelevance(r: BoardRelevance): string {
  if (r.matching === 0) return r.total === 0 ? 'no jobs listed right now' : `no matching jobs (${r.total} listed)`
  return `${r.matching} matching job${r.matching === 1 ? '' : 's'}${r.total > r.matching ? ` of ${r.total}` : ''}`
}
