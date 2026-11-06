import { toPlainText } from '@/lib/text'
import { asString, wantedTitle, fetchJson, parseDate } from './http'
import { SourceError, type JobSourceAdapter, type NormalizedJob, type SearchParams, type SourceContext } from './types'

/**
 * France Travail (formerly Pôle emploi) "Offres d'emploi v2" API. Free client credentials
 * from francetravail.io; OAuth2 client-credentials token, cached for its lifetime.
 * Most postings are in French; the prefilter keeps the English ones.
 */

interface FtOffer {
  id: string
  intitule: string
  description?: string
  dateCreation?: string
  lieuTravail?: { libelle?: string; codePostal?: string }
  entreprise?: { nom?: string }
  typeContrat?: string
  salaire?: { libelle?: string }
  origineOffre?: { urlOrigine?: string }
  competences?: Array<{ libelle?: string }>
  langues?: Array<{ libelle?: string }>
}

interface FtSearch {
  resultats?: FtOffer[]
}

const TOKEN_URL = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire'
const SEARCH_URL = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search'
const PAGE_SIZE = 150

let cachedToken: { value: string; expiresAt: number } | null = null

async function getToken(ctx: SourceContext): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ctx.env.FRANCETRAVAIL_CLIENT_ID ?? '',
    client_secret: ctx.env.FRANCETRAVAIL_CLIENT_SECRET ?? '',
    scope: 'api_offresdemploiv2 o2dsoffre',
  })
  const res = await ctx.fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!res.ok) throw new SourceError('francetravail', `Token request failed (HTTP ${res.status}); check FRANCETRAVAIL_CLIENT_ID / SECRET`, res.status)
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new SourceError('francetravail', 'Token response had no access_token')
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 1400) * 1000 }
  return cachedToken.value
}

export const franceTravailAdapter: JobSourceAdapter = {
  id: 'francetravail',
  label: 'France Travail',
  usesQuery: true,
  usesCountry: true,
  supportedCountries: new Set(['FR']),
  isConfigured: (ctx) => Boolean(ctx.env.FRANCETRAVAIL_CLIENT_ID && ctx.env.FRANCETRAVAIL_CLIENT_SECRET),
  async fetch(params: SearchParams, ctx: SourceContext) {
    const token = await getToken(ctx)
    const start = (params.page - 1) * PAGE_SIZE
    const url = new URL(SEARCH_URL)
    url.searchParams.set('motsCles', params.query)
    url.searchParams.set('range', `${start}-${start + PAGE_SIZE - 1}`)
    url.searchParams.set('publieeDepuis', String(Math.min(31, Math.max(1, params.maxDaysOld))))
    url.searchParams.set('sort', '1')
    const res = await fetchJson<FtSearch>(url.toString(), { method: 'GET', headers: { authorization: `Bearer ${token}` } }, { source: 'francetravail', fetchImpl: ctx.fetch })
    const cutoff = Date.now() - params.maxDaysOld * 86_400_000
    const jobs: NormalizedJob[] = []
    for (const o of res.resultats ?? []) {
      if (!wantedTitle(o.intitule ?? '', ctx.search) && !((ctx.search.profession ?? 'software') === 'software' && /d[ée]veloppeu|ing[ée]nieur (logiciel|d[ée]veloppement)|software/i.test(o.intitule ?? ''))) continue
      const postedAt = parseDate(o.dateCreation)
      if (postedAt && postedAt.getTime() < cutoff) continue
      const location = asString(o.lieuTravail?.libelle).replace(/^\d+\s*-\s*/, '')
      jobs.push({
        source: 'francetravail',
        externalId: o.id,
        url: o.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${o.id}`,
        title: o.intitule,
        company: asString(o.entreprise?.nom) || 'Unknown employer',
        location: location || 'France',
        countryCode: 'FR',
        remote: /t[ée]l[ée]travail|remote/i.test(`${o.description ?? ''}`),
        description: toPlainText(o.description ?? ''),
        postedAt,
        visaSponsorship: null,
        tags: [o.typeContrat ?? '', ...(o.competences ?? []).map((c) => c.libelle ?? '').slice(0, 8)].filter(Boolean),
        raw: { id: o.id, salaire: o.salaire?.libelle, langues: o.langues?.map((l) => l.libelle) },
      })
    }
    return { jobs, hasMore: (res.resultats?.length ?? 0) === PAGE_SIZE, requests: 1 }
  },
}
