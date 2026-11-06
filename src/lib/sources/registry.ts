import type { SourceId } from '@/lib/domain'
import { adzunaAdapter } from './adzuna'
import { arbeitnowAdapter, arbeitnowUkAdapter } from './arbeitnow'
import { atsAdapter } from './ats'
import { bundesagenturAdapter } from './bundesagentur'
import { euresAdapter } from './eures'
import { franceTravailAdapter } from './francetravail'
import { freehireAdapter } from './freehire'
import { hnAdapter } from './hn'
import { jobindexAdapter } from './jobindex'
import { jobnetAdapter } from './jobnet'
import { joobleAdapter } from './jooble'
import { jsearchAdapter } from './jsearch'
import { landingJobsAdapter } from './landingjobs'
import { linkedInAdapter } from './linkedin'
import { reedAdapter } from './reed'
import { himalayasAdapter, jobicyAdapter, remoteOkAdapter, workingNomadsAdapter } from './remote-feeds'
import { remotiveAdapter } from './remotive'
import { scrapeAdapter } from './scrape'
import { theMuseAdapter } from './themuse'
import type { JobSourceAdapter } from './types'

export const SOURCE_ADAPTERS: Record<SourceId, JobSourceAdapter> = {
  arbeitnow: arbeitnowAdapter,
  arbeitnow_uk: arbeitnowUkAdapter,
  eures: euresAdapter,
  ats: atsAdapter,
  freehire: freehireAdapter,
  jobnet: jobnetAdapter,
  jobindex: jobindexAdapter,
  bundesagentur: bundesagenturAdapter,
  hn: hnAdapter,
  landingjobs: landingJobsAdapter,
  themuse: theMuseAdapter,
  jobicy: jobicyAdapter,
  himalayas: himalayasAdapter,
  remoteok: remoteOkAdapter,
  workingnomads: workingNomadsAdapter,
  remotive: remotiveAdapter,
  jooble: joobleAdapter,
  adzuna: adzunaAdapter,
  reed: reedAdapter,
  francetravail: franceTravailAdapter,
  jsearch: jsearchAdapter,
  linkedin: linkedInAdapter,
  scrape: scrapeAdapter,
}

/** Execution order: free and high-signal first, keyed aggregators next, the slow ones last. */
export const SOURCE_ORDER: SourceId[] = [
  'arbeitnow',
  'freehire',
  'ats',
  'hn',
  'eures',
  'jobnet',
  'jobindex',
  'bundesagentur',
  'landingjobs',
  'themuse',
  'jobicy',
  'himalayas',
  'remoteok',
  'workingnomads',
  'remotive',
  'arbeitnow_uk',
  'jooble',
  'adzuna',
  'reed',
  'francetravail',
  'jsearch',
  'linkedin',
  'scrape',
]

export * from './types'
