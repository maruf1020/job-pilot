import { db } from '@/lib/db'
import { normalizeCompany } from '@/lib/text'

/**
 * Official sponsor registers, imported into the SponsorRegister table and matched to
 * companies by normalised name:
 *  - Ireland: employment permits issued per employer (Department of Enterprise), monthly XLSX
 *  - United Kingdom: register of licensed sponsors (Home Office), daily CSV; Skilled Worker route
 *  - Netherlands: IND public register of recognised sponsors (HTML table)
 * A company on a register is marked "known sponsor", which lifts its ranking and tells the
 * emails that sponsorship is realistic.
 */

export type RegisterCountry = 'IE' | 'GB' | 'NL'
export const REGISTER_COUNTRIES: RegisterCountry[] = ['IE', 'GB', 'NL']

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 job-pilot'

interface RegisterRow {
  name: string
  route?: string
  permits?: number
  city?: string
}

export interface ImportResult {
  country: RegisterCountry
  source: string
  rows: number
  skipped: number
}

async function getText(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html,text/csv,*/*' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  return res.text()
}

async function getBuffer(url: string, fetchImpl: typeof fetch): Promise<ArrayBuffer> {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`)
  return res.arrayBuffer()
}

/** Minimal RFC-4180 CSV parser (quotes, embedded commas and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
  }
  return rows
}

/** Replace a country's rows with a fresh import (deduped by normalised name; permits summed). */
async function replaceCountry(country: RegisterCountry, source: string, rows: RegisterRow[]): Promise<ImportResult> {
  const byKey = new Map<string, RegisterRow & { normalizedName: string }>()
  let skipped = 0
  for (const r of rows) {
    const name = r.name.replace(/\s+/g, ' ').trim()
    const normalizedName = normalizeCompany(name)
    if (!normalizedName || normalizedName.length < 2) {
      skipped++
      continue
    }
    const prev = byKey.get(normalizedName)
    if (prev) {
      prev.permits = (prev.permits ?? 0) + (r.permits ?? 0) || prev.permits
      continue
    }
    byKey.set(normalizedName, { ...r, name, normalizedName })
  }
  const data = [...byKey.values()].map((r) => ({ country, name: r.name.slice(0, 200), normalizedName: r.normalizedName.slice(0, 200), route: r.route?.slice(0, 80) ?? null, permits: r.permits ?? null, city: r.city?.slice(0, 120) ?? null, source }))
  // The UK register is ~100k rows: allow the transaction a few minutes instead of Prisma's 5 s default.
  await db.$transaction(
    async (tx) => {
      await tx.sponsorRegister.deleteMany({ where: { country } })
      for (let i = 0; i < data.length; i += 2000) await tx.sponsorRegister.createMany({ data: data.slice(i, i + 2000), skipDuplicates: true })
    },
    { timeout: 5 * 60_000, maxWait: 30_000 },
  )
  return { country, source, rows: data.length, skipped }
}

// ---------------------------------------------------------------------------
// Ireland: https://enterprise.gov.ie/en/publications/employment-permit-statistics-<year>.html
// ---------------------------------------------------------------------------

export async function importIrishRegister(fetchImpl: typeof fetch = globalThis.fetch): Promise<ImportResult> {
  const year = new Date().getFullYear()
  let xlsxUrl: string | null = null
  let usedYear = year
  for (const y of [year, year - 1]) {
    try {
      const html = await getText(`https://enterprise.gov.ie/en/publications/employment-permit-statistics-${y}.html`, fetchImpl)
      const m = /href="([^"]*employment-permits-issued-to-companies-\d{4}\.xlsx[^"]*)"/i.exec(html)
      if (m) {
        xlsxUrl = new URL(m[1], 'https://enterprise.gov.ie').toString()
        usedYear = y
        break
      }
    } catch {
      /* try the previous year */
    }
  }
  if (!xlsxUrl) throw new Error('Could not find the "employment permits issued to companies" workbook on enterprise.gov.ie')
  const XLSX = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(await getBuffer(xlsxUrl, fetchImpl)), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
  const out: RegisterRow[] = []
  for (const r of rows.slice(1)) {
    const name = String(r[0] ?? '').trim()
    if (!name || /^employer name$/i.test(name) || /^total/i.test(name)) continue
    const numbers = r.slice(1).map((v) => (typeof v === 'number' ? v : Number(v))).filter((n) => Number.isFinite(n))
    // Last column is the year total; if absent, sum the months.
    const permits = numbers.length ? Math.max(numbers[numbers.length - 1], numbers.slice(0, -1).reduce((a, b) => a + b, 0)) : undefined
    out.push({ name, permits, route: 'Employment permit' })
  }
  return replaceCountry('IE', `DETE employment permits issued to companies ${usedYear}`, out)
}

// ---------------------------------------------------------------------------
// United Kingdom: https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers
// ---------------------------------------------------------------------------

export async function importUkRegister(fetchImpl: typeof fetch = globalThis.fetch): Promise<ImportResult> {
  const page = await getText('https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers', fetchImpl)
  const link = /https:\/\/assets\.publishing\.service\.gov\.uk\/[^"']+\.csv/i.exec(page)?.[0]
  if (!link) throw new Error('Could not find the CSV link on the gov.uk sponsor register page')
  const csv = await getText(link, fetchImpl)
  const rows = parseCsv(csv)
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const iName = header.findIndex((h) => h.startsWith('organisation'))
  const iTown = header.findIndex((h) => h.startsWith('town'))
  const iRoute = header.findIndex((h) => h === 'route')
  const out: RegisterRow[] = []
  for (const r of rows.slice(1)) {
    const route = (r[iRoute] ?? '').trim()
    if (!/skilled worker|global business mobility|scale-up/i.test(route)) continue
    const name = (r[iName] ?? '').trim()
    if (!name) continue
    out.push({ name, route, city: (r[iTown] ?? '').trim() || undefined })
  }
  return replaceCountry('GB', `UK register of licensed sponsors ${link.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''}`.trim(), out)
}

// ---------------------------------------------------------------------------
// Netherlands: https://ind.nl/en/public-register-recognised-sponsors/...
// ---------------------------------------------------------------------------

export async function importDutchRegister(fetchImpl: typeof fetch = globalThis.fetch): Promise<ImportResult> {
  const html = await getText('https://ind.nl/en/public-register-recognised-sponsors/public-register-regular-labour-and-highly-skilled-migrants', fetchImpl)
  const out: RegisterRow[] = []
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim(),
    )
    if (cells.length < 1) continue
    const name = cells[0]
    if (!name || /^(organisation|organisatie|name|naam)$/i.test(name)) continue
    out.push({ name, city: cells[1] || undefined, route: 'Highly skilled migrant' })
  }
  if (out.length < 100) throw new Error(`IND register page parsed to only ${out.length} rows; the page layout may have changed`)
  return replaceCountry('NL', 'IND public register of recognised sponsors', out)
}

export async function importRegisters(countries: RegisterCountry[], fetchImpl: typeof fetch = globalThis.fetch): Promise<{ results: ImportResult[]; errors: Array<{ country: RegisterCountry; error: string }> }> {
  const results: ImportResult[] = []
  const errors: Array<{ country: RegisterCountry; error: string }> = []
  for (const c of countries) {
    try {
      results.push(await (c === 'IE' ? importIrishRegister(fetchImpl) : c === 'GB' ? importUkRegister(fetchImpl) : importDutchRegister(fetchImpl)))
    } catch (err) {
      errors.push({ country: c, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { results, errors }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Words a register name carries that the company name on a posting usually does not:
 * legal forms ("Ltd", "GmbH", "Sp. z o.o."), "Technologies", "Group", and the country of the
 * local entity ("Stripe Technology Europe Ltd" vs "Stripe"). Stripped from the end, repeatedly.
 */
const MATCH_SUFFIXES = [
  'ltd', 'limited', 'plc', 'dac', 'uc', 'unlimited company', 'gmbh', 'ag', 'kg', 'se', 'bv', 'b v', 'nv', 'n v', 'inc', 'incorporated', 'llc', 'llp', 'lp', 'corp', 'corporation',
  'co', 'company', 'ab', 'publ', 'as', 'a s', 'asa', 'aps', 'oy', 'oyj', 'sa', 'sas', 'sl', 's l', 'slu', 'spa', 'srl', 'sp z oo', 'sp z o o', 'sro', 's r o', 'kft', 'zrt', 'ou',
  'pty', 'technologies', 'technology', 'tech', 'group', 'holdings', 'holding', 'international', 'ireland', 'uk', 'europe', 'emea', 'eu', 'germany', 'deutschland', 'netherlands', 'nederland',
]
const MATCH_SUFFIX_RE = new RegExp(`\\s(${MATCH_SUFFIXES.map((w) => w.replace(/ /g, '\\s')).join('|')})$`)

/** A looser key than the company's normalized name, for matching register rows to companies. */
export function sponsorMatchKey(name: string): string {
  let s = normalizeCompany(name) || name.toLowerCase().trim()
  for (let i = 0; i < 4; i++) {
    const next = s.replace(MATCH_SUFFIX_RE, '').trim()
    if (next === s || next.length < 3) break
    s = next
  }
  return s.replace(/\s+/g, ' ')
}

type RegisterHit = { normalizedName: string; country: string; source: string; permits: number | null }

/** All register rows by their loose key (largest employer first); read once per process and kept for an hour. */
let looseIndex: { at: number; map: Map<string, RegisterHit> } | null = null
async function registerIndex(): Promise<Map<string, RegisterHit>> {
  if (looseIndex && Date.now() - looseIndex.at < 3600_000) return looseIndex.map
  const rows = await db.sponsorRegister.findMany({ select: { normalizedName: true, country: true, source: true, permits: true }, orderBy: { permits: { sort: 'desc', nulls: 'last' } } })
  const map = new Map<string, RegisterHit>()
  for (const r of rows) {
    const key = sponsorMatchKey(r.normalizedName)
    if (key.length >= 3 && !map.has(key)) map.set(key, r)
  }
  looseIndex = { at: Date.now(), map }
  return map
}

/** Registers a new company is checked against at ingest time: the exact name first, then the loose key. */
export async function registeredSponsor(normalizedName: string): Promise<{ country: string; source: string; permits: number | null } | null> {
  if (!normalizedName) return null
  const row = await db.sponsorRegister.findFirst({ where: { normalizedName }, select: { country: true, source: true, permits: true }, orderBy: { permits: 'desc' } })
  if (row) return row
  const key = sponsorMatchKey(normalizedName)
  if (key.length < 4) return null
  const loose = (await registerIndex()).get(key)
  return loose ? { country: loose.country, source: loose.source, permits: loose.permits } : null
}

/** Mark every existing company that appears in a register (exact name or loose key) as a known sponsor. */
export async function applyRegistersToCompanies(): Promise<{ matched: number; alreadyKnown: number }> {
  const companies = await db.company.findMany({ select: { id: true, normalizedName: true, knownSponsor: true, notes: true } })
  const index = await registerIndex()
  let matched = 0
  let alreadyKnown = 0
  for (let i = 0; i < companies.length; i += 500) {
    const batch = companies.slice(i, i + 500)
    const hits = await db.sponsorRegister.findMany({ where: { normalizedName: { in: batch.map((c) => c.normalizedName) } }, select: { normalizedName: true, country: true, source: true, permits: true } })
    const byName = new Map<string, RegisterHit>()
    for (const h of hits) if (!byName.has(h.normalizedName)) byName.set(h.normalizedName, h)
    for (const c of batch) {
      const key = sponsorMatchKey(c.normalizedName)
      const h = byName.get(c.normalizedName) ?? (key.length >= 4 ? index.get(key) : undefined)
      if (!h) continue
      if (c.knownSponsor) {
        alreadyKnown++
        continue
      }
      const line = `Sponsor register (${h.country}): ${h.source}${h.permits ? `, ${h.permits} permits` : ''}`
      await db.company.update({ where: { id: c.id }, data: { knownSponsor: true, notes: c.notes ? `${c.notes}\n${line}` : line } })
      matched++
    }
  }
  return { matched, alreadyKnown }
}

export async function registerSummary(): Promise<Array<{ country: string; rows: number; source: string | null; importedAt: Date | null }>> {
  const groups = await db.sponsorRegister.groupBy({ by: ['country'], _count: { _all: true }, _max: { importedAt: true } })
  const out = []
  for (const c of REGISTER_COUNTRIES) {
    const g = groups.find((x) => x.country === c)
    const sample = g ? await db.sponsorRegister.findFirst({ where: { country: c }, select: { source: true } }) : null
    out.push({ country: c, rows: g?._count._all ?? 0, source: sample?.source ?? null, importedAt: g?._max.importedAt ?? null })
  }
  return out
}
