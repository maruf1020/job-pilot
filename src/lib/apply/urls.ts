import { detectAts } from '@/lib/pipeline/ats-detect'
import { PORTAL_SITES, type PortalSite } from '@/lib/settings/schema'

/**
 * The page where the application form is, built from the ATS job id when we have it
 * (much more reliable than clicking through a company's own careers site).
 */

export interface SourceLinkRef {
  source: string
  externalId: string
  url: string
}

export interface FormTarget {
  url: string
  ats: string | null
  site: PortalSite
}

function atsRef(links: SourceLinkRef[]): { ats: string; slug: string; id: string; url: string } | null {
  for (const l of links) {
    if (l.source !== 'ats') continue
    const m = /^([a-z]+):(.+):([^:]+)$/.exec(l.externalId)
    if (m) return { ats: m[1], slug: m[2], id: m[3], url: l.url }
  }
  return null
}

function greenhouseIdFromUrl(url: string): { slug: string | null; id: string } | null {
  try {
    const u = new URL(url)
    const gh = u.searchParams.get('gh_jid')
    const m = /greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?#]+)\/jobs\/(\d+)/.exec(url)
    if (m) return { slug: m[1], id: m[2] }
    if (gh) return { slug: null, id: gh }
  } catch {
    /* not a URL */
  }
  return null
}

export function siteFor(ats: string | null): PortalSite {
  return ats && (PORTAL_SITES as readonly string[]).includes(ats) ? (ats as PortalSite) : 'other'
}

export function formTarget(job: { url: string; atsType: string | null }, links: SourceLinkRef[]): FormTarget {
  const ref = atsRef(links)
  const ats = ref?.ats ?? job.atsType ?? detectAts(job.url)
  const site = siteFor(ats)
  const eu = /\.eu\./.test(ref?.url ?? job.url)
  if (ref) {
    switch (ref.ats) {
      case 'greenhouse':
        return { url: `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${ref.slug}/jobs/${ref.id}`, ats: 'greenhouse', site }
      case 'lever':
        return { url: `https://jobs.${eu ? 'eu.' : ''}lever.co/${ref.slug}/${ref.id}/apply`, ats: 'lever', site }
      case 'ashby':
        return { url: `https://jobs.ashbyhq.com/${ref.slug}/${ref.id}/application`, ats: 'ashby', site }
      case 'workable':
        return { url: `https://apply.workable.com/${ref.slug}/j/${ref.id}/apply/`, ats: 'workable', site }
      case 'workday': {
        const base = ref.url.replace(/\/+$/, '')
        return { url: /\/apply(\/|$)/.test(base) ? base : `${base}/apply`, ats: 'workday', site }
      }
      case 'recruitee': {
        const base = ref.url.replace(/\/+$/, '')
        return { url: /recruitee\.com\/o\//.test(base) && !/\/c\/new$/.test(base) ? `${base}/c/new` : base, ats: 'recruitee', site }
      }
      default:
        return { url: ref.url, ats: ref.ats, site }
    }
  }
  // LinkedIn postings (the LinkedIn source): Easy Apply on the posting page itself.
  const li = /linkedin\.com\/jobs\/view\/(\d+)/.exec(job.url)
  if (li) return { url: `https://www.linkedin.com/jobs/view/${li[1]}/`, ats: 'linkedin', site: 'linkedin' }
  // Jobs found elsewhere whose URL already points at an ATS.
  if (ats === 'greenhouse') {
    const g = greenhouseIdFromUrl(job.url)
    if (g?.slug) return { url: `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${g.slug}/jobs/${g.id}`, ats, site }
  }
  if (ats === 'lever' && /jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}\/?$/.test(job.url)) return { url: `${job.url.replace(/\/+$/, '')}/apply`, ats, site }
  if (ats === 'ashby' && /jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}\/?$/.test(job.url)) return { url: `${job.url.replace(/\/+$/, '')}/application`, ats, site }
  return { url: job.url, ats: ats ?? null, site }
}

/** Query keys that name one job on an otherwise bare careers host (careers.nebius.com/?gh_jid=...). */
const JOB_ID_PARAMS = ['gh_jid', 'job', 'jobid', 'job_id', 'id', 'jid', 'ref', 'p', 'pid', 'vacancy', 'position']

/**
 * Why a stored link has no application form behind it, or null when it may have one. Once the
 * Needs you list held LinkedIn feed posts, company and member pages, jobicy profiles, Hacker News threads,
 * the YC founders' application (apply.ycombinator.com/apps) and bare careers homes that no one could finish.
 */
export function notAJobPage(url: string, companyName?: string | null): string | null {
  if (companyName && /^location:/i.test(companyName.trim())) return 'a "who wants to be hired" post, not a job'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'not a web address'
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const path = u.pathname.replace(/\/+$/, '').toLowerCase()
  const parts = path.split('/').filter(Boolean)
  if (host.endsWith('linkedin.com') && /^\/(feed|posts|company|in|school|groups|pulse)(\/|$)/.test(path)) return 'a LinkedIn page, not a job'
  if (host === 'news.ycombinator.com' || host === 'account.ycombinator.com') return 'a Hacker News page, not a job form'
  if (host === 'apply.ycombinator.com' && parts[0] === 'apps') return "the YC founders' application, not a job"
  if (host.endsWith('jobicy.com') && /^\/(my-profile|profile|login)(\/|$)/.test(path)) return 'a jobicy profile page, not a job'
  const namesJob = [...u.searchParams.keys()].some((k) => JOB_ID_PARAMS.includes(k.toLowerCase()))
  if (namesJob) return null
  if (parts.length === 0) return 'a home page, not a job'
  if (parts.length === 1 && /^(careers?|jobs|join-us|joinus|work-with-us|open-positions|vacancies|karriere|stellenangebote)$/.test(parts[0])) return 'a careers index, not a job'
  return null
}
