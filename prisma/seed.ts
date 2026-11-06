import { existsSync } from 'node:fs'
import path from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '../src/generated/prisma/client'
import { DEFAULT_BANNED_PHRASES } from '../src/lib/pipeline/humanize/banned-phrases'
import { DEFAULT_AI, DEFAULT_EMAIL, DEFAULT_RANKING, DEFAULT_SEARCH } from '../src/lib/settings/schema'
import { importKnowledge, KNOWLEDGE_DIR } from '../scripts/knowledge-lib'

/**
 * Seeds a NEW install with shared, person-free data only: default settings, the banned-phrase list,
 * a starter list of companies with public job boards, example scrape targets, and (when the
 * knowledge pack in database/knowledge is present) the full shared knowledge: companies, job
 * boards, site profiles and the form agents' site lessons.
 *
 * There is no user and no profile here on purpose: the first visit to the app creates the account
 * (/setup) and the onboarding form collects everything about the person.
 */

if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* env provided by host */
  }
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const json = (v: unknown) => v as Prisma.InputJsonValue

// ---------------------------------------------------------------------------
// A starter list of employers known to hire internationally, with public ATS boards. Slugs are
// best-effort: a wrong slug just logs a 404 on the next run and can be fixed in Companies.
// ---------------------------------------------------------------------------
const COMPANIES: Array<{ name: string; countryCode: string; atsType?: string; atsSlug?: string; domain?: string; notes?: string }> = [
  { name: 'Stripe', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'stripe', domain: 'stripe.com', notes: 'Trusted Partner employer (fast CSEP)' },
  { name: 'Intercom', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'intercom', domain: 'intercom.com' },
  { name: 'HubSpot', countryCode: 'IE', domain: 'hubspot.com', notes: 'Custom careers site' },
  { name: 'Workday', countryCode: 'IE', domain: 'workday.com', notes: 'Own ATS' },
  { name: 'Zendesk', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'zendesk', domain: 'zendesk.com' },
  { name: 'Toast', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'toast', domain: 'toasttab.com' },
  { name: 'Udemy', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'udemy', domain: 'udemy.com' },
  { name: 'Tines', countryCode: 'IE', atsType: 'ashby', atsSlug: 'tines', domain: 'tines.com' },
  { name: 'Wayflyer', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'wayflyer', domain: 'wayflyer.com' },
  { name: 'Flipdish', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'flipdish', domain: 'flipdish.com' },
  { name: 'LetsGetChecked', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'letsgetchecked', domain: 'letsgetchecked.com' },
  { name: 'Datadog', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'datadog', domain: 'datadoghq.com' },
  { name: 'Squarespace', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'squarespace', domain: 'squarespace.com' },
  { name: 'Dropbox', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'dropbox', domain: 'dropbox.com' },
  { name: 'Notion', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'notion', domain: 'notion.so' },
  { name: 'Vanta', countryCode: 'IE', atsType: 'ashby', atsSlug: 'vanta', domain: 'vanta.com' },
  { name: 'Tenable', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'tenable', domain: 'tenable.com' },
  { name: 'Cloudflare', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'cloudflare', domain: 'cloudflare.com' },
  { name: 'HashiCorp', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'hashicorp', domain: 'hashicorp.com' },
  { name: 'Twilio', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'twilio', domain: 'twilio.com' },
  { name: 'Coinbase', countryCode: 'IE', atsType: 'greenhouse', atsSlug: 'coinbase', domain: 'coinbase.com' },
  { name: 'Figma', countryCode: 'GB', atsType: 'greenhouse', atsSlug: 'figma', domain: 'figma.com' },
  { name: 'Elastic', countryCode: 'NL', atsType: 'greenhouse', atsSlug: 'elastic', domain: 'elastic.co' },
  { name: 'Adyen', countryCode: 'NL', atsType: 'greenhouse', atsSlug: 'adyen', domain: 'adyen.com' },
  { name: 'Mollie', countryCode: 'NL', atsType: 'greenhouse', atsSlug: 'mollie', domain: 'mollie.com' },
  { name: 'Miro', countryCode: 'NL', atsType: 'greenhouse', atsSlug: 'miro', domain: 'miro.com' },
  { name: 'Booking.com', countryCode: 'NL', domain: 'booking.com', notes: 'Custom careers site' },
  { name: 'N26', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'n26', domain: 'n26.com' },
  { name: 'Trade Republic', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'traderepublic', domain: 'traderepublic.com' },
  { name: 'Zalando', countryCode: 'DE', domain: 'zalando.com', notes: 'Custom careers site' },
  { name: 'Celonis', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'celonis', domain: 'celonis.com' },
  { name: 'Contentful', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'contentful', domain: 'contentful.com' },
  { name: 'GetYourGuide', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'getyourguide', domain: 'getyourguide.com' },
  { name: 'HelloFresh', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'hellofresh', domain: 'hellofresh.com' },
  { name: 'Delivery Hero', countryCode: 'DE', atsType: 'smartrecruiters', atsSlug: 'DeliveryHero', domain: 'deliveryhero.com' },
  { name: 'SumUp', countryCode: 'DE', atsType: 'greenhouse', atsSlug: 'sumup', domain: 'sumup.com' },
  { name: 'Personio', countryCode: 'DE', domain: 'personio.com', notes: 'Own ATS' },
  { name: 'Pleo', countryCode: 'DK', atsType: 'greenhouse', atsSlug: 'pleo', domain: 'pleo.io' },
  { name: 'Spotify', countryCode: 'SE', atsType: 'lever', atsSlug: 'spotify', domain: 'spotify.com' },
  { name: 'Klarna', countryCode: 'SE', domain: 'klarna.com', notes: 'Custom careers site' },
  { name: 'Bolt', countryCode: 'EE', atsType: 'greenhouse', atsSlug: 'bolt', domain: 'bolt.eu' },
  { name: 'Wise', countryCode: 'EE', atsType: 'greenhouse', atsSlug: 'transferwise', domain: 'wise.com' },
  { name: 'Remote', countryCode: 'PT', atsType: 'greenhouse', atsSlug: 'remotecom', domain: 'remote.com' },
  { name: 'Qonto', countryCode: 'FR', atsType: 'lever', atsSlug: 'qonto', domain: 'qonto.com' },
  { name: 'Alan', countryCode: 'FR', atsType: 'lever', atsSlug: 'alan', domain: 'alan.com' },
  { name: 'Typeform', countryCode: 'ES', atsType: 'greenhouse', atsSlug: 'typeform', domain: 'typeform.com' },
  { name: 'Glovo', countryCode: 'ES', atsType: 'greenhouse', atsSlug: 'glovo', domain: 'glovoapp.com' },
  { name: 'Revolut', countryCode: 'GB', atsType: 'greenhouse', atsSlug: 'revolut', domain: 'revolut.com' },
  { name: 'Monzo', countryCode: 'GB', atsType: 'greenhouse', atsSlug: 'monzo', domain: 'monzo.com' },
  { name: 'Deliveroo', countryCode: 'GB', atsType: 'greenhouse', atsSlug: 'deliveroo', domain: 'deliveroo.co.uk' },
]

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(ltd|limited|gmbh|inc|llc|bv|ag|sa|plc|oy|ab|as|corp|co|company|group|holdings|technologies|technology|labs|se)\.?$/i, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function seedSettings() {
  await db.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, search: json(DEFAULT_SEARCH), ranking: json(DEFAULT_RANKING), email: json(DEFAULT_EMAIL), ai: json(DEFAULT_AI) },
  })
  console.log('settings: ok')
}

async function seedBannedPhrases() {
  let n = 0
  for (const p of DEFAULT_BANNED_PHRASES) {
    await db.bannedPhrase.upsert({
      where: { phrase: p.phrase },
      update: {},
      create: { phrase: p.phrase, severity: p.severity, category: p.category, isRegex: Boolean(p.isRegex) },
    })
    n++
  }
  console.log(`banned phrases: ${n}`)
}

async function seedCompanies() {
  let n = 0
  for (const c of COMPANIES) {
    await db.company.upsert({
      where: { normalizedName: normalizeCompany(c.name) },
      update: {},
      create: { name: c.name, normalizedName: normalizeCompany(c.name), countryCode: c.countryCode, atsType: c.atsType, atsSlug: c.atsSlug, domain: c.domain, knownSponsor: true, notes: c.notes },
    })
    n++
  }
  console.log(`starter companies: ${n}`)
}

/** Example browser-scraping targets, disabled until reviewed. `{page}` is replaced with 1..maxPages. */
const SCRAPE_TARGETS = [
  {
    name: 'Example: Jobs.ie (Ireland)',
    url: 'https://www.jobs.ie/jobs/software-engineer?page={page}',
    countryCode: 'IE',
    maxPages: 2,
    notes: 'Example only. Enable after checking the site terms and changing the search words in the URL to your field. Links are discovered heuristically; set a link pattern if results look wrong.',
  },
  {
    name: 'Example: EU remote jobs board',
    url: 'https://euremotejobs.com/job-category/software-development/',
    countryCode: null,
    maxPages: 1,
    notes: 'Example only. Remote EU roles; most pages have an application email. Pick the category that matches your field.',
  },
]

async function seedScrapeTargets() {
  let n = 0
  for (const t of SCRAPE_TARGETS) {
    const existing = await db.scrapeTarget.findFirst({ where: { url: t.url } })
    if (existing) continue
    await db.scrapeTarget.create({ data: { ...t, enabled: false, requireEmail: true } })
    n++
  }
  console.log(`scrape targets: ${n} example(s) added (disabled)`)
}

async function main() {
  await seedSettings()
  await seedBannedPhrases()
  await seedCompanies()
  await seedScrapeTargets()
  // The shipped knowledge pack (companies, boards, site profiles, lessons). Safe to run again: rows
  // are matched by their natural keys and never overwrite what this install already learned.
  if (existsSync(path.resolve(KNOWLEDGE_DIR, 'manifest.json'))) {
    const report = await importKnowledge(db, { log: (m) => console.log(`knowledge: ${m}`) })
    console.log(`knowledge pack: ${Object.entries(report).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  } else {
    console.log('knowledge pack: none in database/knowledge (npm run knowledge:import after adding one)')
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect()
    process.exit(1)
  })
