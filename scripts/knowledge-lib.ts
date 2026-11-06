/**
 * The knowledge pack: the shared, person-free data that makes a fresh install "trained" -
 * companies and their job boards, sponsor registers, scrape targets, banned phrases, what each
 * application site is like (HostProfile) and what the form agents learned there (SiteLesson).
 * Optionally the jobs found so far (large; kept out of git, shared as a separate file).
 *
 * Format: database/knowledge/<table>.ndjson.gz (one JSON row per line) + manifest.json.
 * Export never includes personal data: only the shared columns are written, and lesson texts pass
 * through scrubPersonal() against the current profile once more. Import only adds what is missing
 * (natural keys), so it never overwrites what an install learned itself.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip, createGzip } from 'node:zlib'
import { once } from 'node:events'
import type { PrismaClient } from '../src/generated/prisma/client'
import { buildCandidateContext, scrubPersonal } from '../src/lib/candidate/context'

export const KNOWLEDGE_DIR = path.resolve(process.cwd(), 'database', 'knowledge')
const CHUNK = 2000

type Row = Record<string, unknown>
export type KnowledgeTable = 'companies' | 'sponsors' | 'scrapeTargets' | 'bannedPhrases' | 'siteProfiles' | 'siteLessons' | 'jobs' | 'jobLinks'
export const DEFAULT_TABLES: KnowledgeTable[] = ['companies', 'sponsors', 'scrapeTargets', 'bannedPhrases', 'siteProfiles', 'siteLessons']

const file = (dir: string, t: KnowledgeTable) => path.join(dir, `${t}.ndjson.gz`)

async function writeNdjson(target: string, rows: AsyncIterable<Row> | Row[]): Promise<number> {
  const gz = createGzip({ level: 9 })
  const out = createWriteStream(target)
  gz.pipe(out)
  let n = 0
  for await (const r of rows as AsyncIterable<Row>) {
    if (!gz.write(`${JSON.stringify(r)}\n`)) await once(gz, 'drain')
    n++
  }
  gz.end()
  await once(out, 'finish')
  return n
}

async function* readNdjson(source: string): AsyncGenerator<Row> {
  const rl = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity })
  for await (const line of rl) if (line.trim()) yield JSON.parse(line) as Row
}

async function* chunks<T>(rows: AsyncIterable<T>, size = CHUNK): AsyncGenerator<T[]> {
  let buf: T[] = []
  for await (const r of rows) {
    buf.push(r)
    if (buf.length >= size) {
      yield buf
      buf = []
    }
  }
  if (buf.length) yield buf
}

/** Pages through a table by id so a 140k-row export never loads at once. */
async function* paged<T extends { id: string }>(fetch: (cursor: string | null) => Promise<T[]>): AsyncGenerator<T> {
  let cursor: string | null = null
  for (;;) {
    const page = await fetch(cursor)
    if (!page.length) return
    for (const r of page) yield r
    cursor = page[page.length - 1].id
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/**
 * Only role mailboxes (jobs@, careers@, hr@, ...) go into a shared pack: an address of a named
 * recruiter is that person's data. The install that found it keeps it in its own database.
 */
const ROLE_LOCAL = /^(jobs?|careers?|career|hr|hiring|recruit(ing|ment|er|ers)?|talent(acquisition)?|people|apply|applications?|vacanc(y|ies)|work|join(us)?|team|hello|hi|info|contact|office|personal|bewerbung(en)?|karriere|stellen|empleo|rh|rrhh|emploi|candidature|lavora|werken|vacatures|sollicitatie|praca|rekrytointi|jobb|cv|resume|resumes)([._+-].*)?$/i
const PERSONAL_DOMAINS = /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|gmx|yandex|aol|mail|web|t-online|orange|libero|wp|o2)\.[a-z.]+$/i
export function isRoleAddress(email: string | null | undefined): boolean {
  const e = (email ?? '').trim()
  const local = e.split('@')[0] ?? ''
  return ROLE_LOCAL.test(local) && !PERSONAL_DOMAINS.test(e)
}
const roleOnly = (email: string | null) => (email && isRoleAddress(email) ? email : null)
/** Crawl notes list every address tried: keep the role mailboxes, mask the rest. */
const maskAddresses = (text: string | null) => (text ? text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => (isRoleAddress(m) ? m : '(an address)')) : text)
const date = (v: unknown) => (typeof v === 'string' ? new Date(v) : null)

export async function exportKnowledge(db: PrismaClient, opts: { dir?: string; jobs?: boolean; log?: (m: string) => void } = {}): Promise<Record<string, number>> {
  const dir = opts.dir ?? KNOWLEDGE_DIR
  const log = opts.log ?? (() => {})
  mkdirSync(dir, { recursive: true })
  const profile = await db.candidateProfile.findUnique({ where: { id: 1 } })
  const ctx = profile ? buildCandidateContext(profile as unknown as Record<string, unknown>) : null
  const clean = (s: string | null) => (s && ctx ? scrubPersonal(s, ctx) : s)
  const counts: Record<string, number> = {}

  counts.companies = await writeNdjson(
    file(dir, 'companies'),
    (async function* () {
      for await (const c of paged((cursor) => db.company.findMany({ take: CHUNK, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })))
        yield {
          name: c.name,
          normalizedName: c.normalizedName,
          domain: c.domain,
          countryCode: c.countryCode,
          atsType: c.atsType,
          atsSlug: c.atsSlug,
          careersUrl: c.careersUrl,
          contactEmail: roleOnly(c.contactEmail),
          contactEmailSource: roleOnly(c.contactEmail) ? c.contactEmailSource : null,
          contactCandidates: c.contactCandidates.filter(isRoleAddress),
          contactCheckedAt: roleOnly(c.contactEmail) ? iso(c.contactCheckedAt) : null,
          contactNotes: maskAddresses(clean(c.contactNotes)),
          knownSponsor: c.knownSponsor,
          boardSource: c.boardSource,
          boardCheckedAt: iso(c.boardCheckedAt),
        }
    })(),
  )
  log(`companies ${counts.companies}`)

  counts.sponsors = await writeNdjson(
    file(dir, 'sponsors'),
    (async function* () {
      for await (const s of paged((cursor) => db.sponsorRegister.findMany({ take: CHUNK * 5, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })))
        yield { country: s.country, name: s.name, normalizedName: s.normalizedName, route: s.route, permits: s.permits, city: s.city, source: s.source }
    })(),
  )
  log(`sponsors ${counts.sponsors}`)

  counts.scrapeTargets = await writeNdjson(
    file(dir, 'scrapeTargets'),
    (await db.scrapeTarget.findMany({ orderBy: { createdAt: 'asc' } })).map((t) => ({
      name: t.name,
      url: t.url,
      enabled: false,
      linkSelector: t.linkSelector,
      linkPattern: t.linkPattern,
      maxLinks: t.maxLinks,
      maxPages: t.maxPages,
      requireEmail: t.requireEmail,
      countryCode: t.countryCode,
      waitMs: t.waitMs,
      notes: clean(t.notes),
    })),
  )
  counts.bannedPhrases = await writeNdjson(
    file(dir, 'bannedPhrases'),
    (await db.bannedPhrase.findMany({ orderBy: { createdAt: 'asc' } })).map((p) => ({ phrase: p.phrase, severity: p.severity, category: p.category, isRegex: p.isRegex, enabled: p.enabled })),
  )
  // What each site is like; the free-text reason and notes may describe a person, so they stay out.
  counts.siteProfiles = await writeNdjson(
    file(dir, 'siteProfiles'),
    (await db.hostProfile.findMany({ orderBy: { host: 'asc' } })).map((h) => ({
      host: h.host,
      kind: h.kind,
      atsType: h.atsType,
      attempts: h.attempts,
      submitted: h.submitted,
      needsHuman: h.needsHuman,
      failed: h.failed,
      lastOutcome: h.lastOutcome,
    })),
  )
  counts.siteLessons = await writeNdjson(
    file(dir, 'siteLessons'),
    (await db.siteLesson.findMany({ orderBy: { createdAt: 'asc' } })).map((l) => ({
      kind: l.kind,
      host: l.host,
      type: l.type,
      outcome: l.outcome,
      lesson: clean(l.lesson),
      category: l.category,
      pattern: clean(l.pattern),
      blocker: clean(l.blocker),
      fingerprint: l.fingerprint,
      hits: l.hits,
      createdAt: iso(l.createdAt),
    })),
  )
  log(`site profiles ${counts.siteProfiles}, lessons ${counts.siteLessons}`)

  if (opts.jobs) {
    counts.jobs = await writeNdjson(
      file(dir, 'jobs'),
      (async function* () {
        for await (const j of paged((cursor) =>
          db.job.findMany({ take: CHUNK, orderBy: { id: 'asc' }, include: { company: { select: { normalizedName: true } } }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
        ))
          yield {
            dedupeKey: j.dedupeKey,
            company: j.company.normalizedName,
            title: j.title,
            companyName: j.companyName,
            url: j.url,
            location: j.location,
            countryCode: j.countryCode,
            remote: j.remote,
            description: j.description,
            salaryMin: j.salaryMin,
            salaryMax: j.salaryMax,
            currency: j.currency,
            postedAt: iso(j.postedAt),
            firstSeenAt: iso(j.firstSeenAt),
            lastSeenAt: iso(j.lastSeenAt),
            primarySource: j.primarySource,
            tags: j.tags,
            visaFlag: j.visaFlag,
            sponsorship: j.sponsorship,
            sponsorshipEvidence: j.sponsorshipEvidence,
            applyChannel: j.applyChannel,
            atsType: j.atsType,
            contactEmail: roleOnly(j.contactEmail),
            contactEmailSource: roleOnly(j.contactEmail) ? j.contactEmailSource : null,
            contactCandidates: j.contactCandidates.filter(isRoleAddress),
            language: j.language,
            seniority: j.seniority,
            mustHaveSkills: j.mustHaveSkills,
            niceToHaveSkills: j.niceToHaveSkills,
            requiredLanguages: j.requiredLanguages,
            relocationSupport: j.relocationSupport,
            summary: j.summary,
            enrichedAt: iso(j.enrichedAt),
          }
      })(),
    )
    counts.jobLinks = await writeNdjson(
      file(dir, 'jobLinks'),
      (async function* () {
        for await (const l of paged((cursor) =>
          db.jobSourceLink.findMany({ take: CHUNK * 2, orderBy: { id: 'asc' }, include: { job: { select: { dedupeKey: true } } }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
        ))
          yield { job: l.job.dedupeKey, source: l.source, externalId: l.externalId, url: l.url, firstSeenAt: iso(l.firstSeenAt), lastSeenAt: iso(l.lastSeenAt) }
      })(),
    )
    log(`jobs ${counts.jobs}, job links ${counts.jobLinks}`)
  }

  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ format: 1, exportedAt: new Date().toISOString(), counts }, null, 2)}\n`)
  return counts
}

export async function importKnowledge(db: PrismaClient, opts: { dir?: string; tables?: KnowledgeTable[]; log?: (m: string) => void } = {}): Promise<Record<string, number>> {
  const dir = opts.dir ?? KNOWLEDGE_DIR
  const log = opts.log ?? (() => {})
  const want = new Set(opts.tables ?? [...DEFAULT_TABLES, 'jobs', 'jobLinks'])
  const has = (t: KnowledgeTable) => want.has(t) && existsSync(file(dir, t))
  const added: Record<string, number> = {}
  if (!existsSync(path.join(dir, 'manifest.json'))) throw new Error(`No knowledge pack in ${dir} (manifest.json missing)`)
  JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))

  if (has('companies')) {
    let n = 0
    for await (const batch of chunks(readNdjson(file(dir, 'companies'))))
      n += (
        await db.company.createMany({
          data: batch.map((c) => ({ ...(c as object), contactCheckedAt: date(c.contactCheckedAt), boardCheckedAt: date(c.boardCheckedAt) }) as never),
          skipDuplicates: true,
        })
      ).count
    added.companies = n
    log(`companies +${n}`)
  }
  if (has('sponsors')) {
    let n = 0
    for await (const batch of chunks(readNdjson(file(dir, 'sponsors')), 5000)) n += (await db.sponsorRegister.createMany({ data: batch as never, skipDuplicates: true })).count
    added.sponsors = n
    log(`sponsors +${n}`)
  }
  if (has('scrapeTargets')) {
    let n = 0
    for await (const t of readNdjson(file(dir, 'scrapeTargets'))) {
      if (await db.scrapeTarget.findFirst({ where: { url: String(t.url) }, select: { id: true } })) continue
      await db.scrapeTarget.create({ data: t as never })
      n++
    }
    added.scrapeTargets = n
  }
  if (has('bannedPhrases')) {
    const rows: Row[] = []
    for await (const r of readNdjson(file(dir, 'bannedPhrases'))) rows.push(r)
    added.bannedPhrases = (await db.bannedPhrase.createMany({ data: rows as never, skipDuplicates: true })).count
  }
  if (has('siteProfiles')) {
    const rows: Row[] = []
    for await (const r of readNdjson(file(dir, 'siteProfiles'))) rows.push(r)
    added.siteProfiles = (await db.hostProfile.createMany({ data: rows as never, skipDuplicates: true })).count
  }
  if (has('siteLessons')) {
    let n = 0
    for await (const batch of chunks(readNdjson(file(dir, 'siteLessons'))))
      n += (await db.siteLesson.createMany({ data: batch.map((l) => ({ ...(l as object), createdAt: date(l.createdAt) ?? new Date() })) as never, skipDuplicates: true })).count
    added.siteLessons = n
    log(`site lessons +${n}`)
  }
  if (has('jobs')) {
    const companyIds = new Map((await db.company.findMany({ select: { id: true, normalizedName: true } })).map((c) => [c.normalizedName, c.id]))
    let n = 0
    for await (const batch of chunks(readNdjson(file(dir, 'jobs')))) {
      const data = batch
        .filter((j) => companyIds.has(String(j.company)))
        .map((j) => {
          const { company, ...rest } = j
          return {
            ...rest,
            companyId: companyIds.get(String(company))!,
            postedAt: date(j.postedAt),
            firstSeenAt: date(j.firstSeenAt) ?? new Date(),
            lastSeenAt: date(j.lastSeenAt) ?? new Date(),
            enrichedAt: date(j.enrichedAt),
            status: 'NEW',
          }
        })
      n += (await db.job.createMany({ data: data as never, skipDuplicates: true })).count
    }
    added.jobs = n
    log(`jobs +${n}`)
  }
  if (has('jobLinks')) {
    let n = 0
    for await (const batch of chunks(readNdjson(file(dir, 'jobLinks')), 5000)) {
      const keys = [...new Set(batch.map((l) => String(l.job)))]
      const ids = new Map((await db.job.findMany({ where: { dedupeKey: { in: keys } }, select: { id: true, dedupeKey: true } })).map((j) => [j.dedupeKey, j.id]))
      const data = batch
        .filter((l) => ids.has(String(l.job)))
        .map((l) => ({ jobId: ids.get(String(l.job))!, source: l.source, externalId: l.externalId, url: l.url, firstSeenAt: date(l.firstSeenAt) ?? new Date(), lastSeenAt: date(l.lastSeenAt) ?? new Date() }))
      n += (await db.jobSourceLink.createMany({ data: data as never, skipDuplicates: true })).count
    }
    added.jobLinks = n
    log(`job links +${n}`)
  }
  return added
}
