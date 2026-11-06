import { guessCountry, isRemoteLocation } from '@/lib/geo'
import { toPlainText } from '@/lib/text'
import { asString, wantedTitle, type TitleSearch, fetchJson, parseDate, sleep } from './http'
import type { JobSourceAdapter, NormalizedJob, SearchParams, SourceContext } from './types'
import { SourceError } from './types'

/**
 * Bundesagentur fuer Arbeit job search (Germany's official job board), the API its own app uses
 * (https://github.com/bundesAPI/jobsuche-api): a published public key, no account. Most postings
 * are in German, so titles that are clearly German are skipped before the detail call; the
 * prefilter drops the rest by language. Some networks get HTTP 403: then the source rests for six
 * hours and the run goes on quietly.
 */

const API = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4'
const HEADERS = { 'X-API-Key': 'jobboerse-jobsuche' }
const PAGE_SIZE = 50
const MAX_DETAILS_PER_PAGE = 20

interface BaPosting {
  refnr: string
  titel?: string
  beruf?: string
  arbeitgeber?: string
  arbeitsort?: { ort?: string; region?: string; land?: string; plz?: string }
  aktuelleVeroeffentlichungsdatum?: string
  modifikationsTimestamp?: string
  externeUrl?: string
}

interface BaSearch {
  stellenangebote?: BaPosting[]
  maxErgebnisse?: string | number
}

interface BaDetail {
  stellenangebotsBeschreibung?: string
  stellenbeschreibung?: string
  stellenangebotsTitel?: string
  arbeitgeber?: string
  externeUrl?: string
  allianzpartnerUrl?: string
}

/** German titles ("Softwareentwickler (m/w/d)", "Fachinformatiker") mean a German posting. */
const GERMAN_TITLE_RE = /(entwickler|informatiker|ingenieur|mitarbeiter|leiter|berater|werkstudent|praktik|ausbildung|sachbearbeiter|anwendungsbetreuer|systembetreuer|programmierer)/i

let blockedUntil = 0

export function baSearchUrl(params: SearchParams): string {
  const q = new URLSearchParams({
    was: params.query,
    angebotsart: '1',
    page: String(params.page),
    size: String(PAGE_SIZE),
    veroeffentlichtseit: String(Math.max(1, Math.min(100, params.maxDaysOld))),
  })
  return `${API}/jobs?${q}`
}

/** The public job page for a posting. */
export function baJobUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}`
}

function detailUrl(refnr: string): string {
  return `${API}/jobdetails/${Buffer.from(refnr, 'utf8').toString('base64')}`
}

/** Search rows worth a detail call: engineering titles that are not German. */
export function baCandidates(rows: BaPosting[], search?: TitleSearch): BaPosting[] {
  return rows.filter((r) => {
    const title = asString(r.titel || r.beruf)
    return Boolean(r.refnr) && wantedTitle(title, search) && !GERMAN_TITLE_RE.test(title)
  })
}

export function normalizeBaPosting(p: BaPosting, detail: BaDetail | null): NormalizedJob {
  const place = [p.arbeitsort?.ort, p.arbeitsort?.region, p.arbeitsort?.land].filter(Boolean).join(', ')
  const description = toPlainText(asString(detail?.stellenangebotsBeschreibung ?? detail?.stellenbeschreibung))
  const external = asString(detail?.externeUrl ?? p.externeUrl)
  return {
    source: 'bundesagentur',
    externalId: p.refnr,
    url: /^https?:\/\//.test(external) ? external : baJobUrl(p.refnr),
    title: asString(detail?.stellenangebotsTitel || p.titel || p.beruf),
    company: asString(detail?.arbeitgeber || p.arbeitgeber) || 'Unknown company',
    location: place || undefined,
    countryCode: guessCountry(place, 'DE'),
    remote: isRemoteLocation(place),
    description,
    postedAt: parseDate(p.aktuelleVeroeffentlichungsdatum ?? p.modifikationsTimestamp),
    visaSponsorship: null,
    tags: [p.beruf ?? ''].filter(Boolean),
    raw: { refnr: p.refnr },
  }
}

export const bundesagenturAdapter: JobSourceAdapter = {
  id: 'bundesagentur',
  label: 'Bundesagentur (Germany, official)',
  usesQuery: true,
  usesCountry: true,
  supportedCountries: new Set(['DE']),
  isConfigured: () => true,
  async fetch(params: SearchParams, ctx: SourceContext) {
    if (Date.now() < blockedUntil) return { jobs: [], hasMore: false, requests: 0 }
    let res: BaSearch
    try {
      res = await fetchJson<BaSearch>(baSearchUrl(params), { method: 'GET', headers: HEADERS }, { source: 'bundesagentur', fetchImpl: ctx.fetch })
    } catch (err) {
      if (err instanceof SourceError && (err.status === 403 || err.status === 401)) {
        blockedUntil = Date.now() + 6 * 3600_000
        ctx.log('info', `Bundesagentur: not available from this network (HTTP ${err.status}); skipped for six hours`)
        return { jobs: [], hasMore: false, requests: 1 }
      }
      throw err
    }
    const rows = res.stellenangebote ?? []
    let requests = 1
    const jobs: NormalizedJob[] = []
    for (const p of baCandidates(rows, ctx.search).slice(0, MAX_DETAILS_PER_PAGE)) {
      let detail: BaDetail | null = null
      try {
        detail = await fetchJson<BaDetail>(detailUrl(p.refnr), { method: 'GET', headers: HEADERS }, { source: 'bundesagentur', fetchImpl: ctx.fetch, retries: 0 })
        requests++
      } catch (err) {
        requests++
        ctx.log('debug', `Bundesagentur detail ${p.refnr} failed: ${err instanceof Error ? err.message : err}`)
      }
      jobs.push(normalizeBaPosting(p, detail))
      await sleep(250)
    }
    const total = Number(res.maxErgebnisse ?? 0)
    return { jobs, hasMore: rows.length === PAGE_SIZE && params.page * PAGE_SIZE < total, requests }
  },
}

/** For tests: forget a 403 rest. */
export function _resetBundesagenturBlock(): void {
  blockedUntil = 0
}
