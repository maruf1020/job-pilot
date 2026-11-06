/**
 * Pure service definitions (no database): which services exist, their fields and docs. Shared
 * by the importer's detection (unit-tested without a DB) and service-keys.ts.
 */

export interface ServiceField {
  name: string
  label: string
  secret: boolean
  /** Optional fields may stay empty (the service still works). */
  optional?: boolean
}

export interface ServiceDef {
  service: string
  label: string
  fields: ServiceField[]
  docsUrl?: string
  /** One line on what it is for. */
  description: string
}

export const SERVICE_DEFS: ServiceDef[] = [
  {
    service: 'adzuna',
    label: 'Adzuna',
    description: 'Job search API (many countries).',
    docsUrl: 'https://developer.adzuna.com/',
    fields: [
      { name: 'ADZUNA_APP_ID', label: 'App ID', secret: false },
      { name: 'ADZUNA_APP_KEY', label: 'App key', secret: true },
    ],
  },
  {
    service: 'jooble',
    label: 'Jooble',
    description: 'Job search API.',
    docsUrl: 'https://jooble.org/api/about',
    fields: [{ name: 'JOOBLE_KEY', label: 'API key', secret: true }],
  },
  {
    service: 'rapidapi',
    label: 'RapidAPI (JSearch)',
    description: 'JSearch job listings through RapidAPI.',
    docsUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    fields: [{ name: 'RAPIDAPI_KEY', label: 'RapidAPI key', secret: true }],
  },
  {
    service: 'reed',
    label: 'Reed',
    description: 'Reed.co.uk Jobseeker API (UK jobs).',
    docsUrl: 'https://www.reed.co.uk/developers/jobseeker',
    fields: [{ name: 'REED_KEY', label: 'API key', secret: true }],
  },
  {
    service: 'francetravail',
    label: 'France Travail',
    description: 'France Travail "Offres d\'emploi v2" (French jobs).',
    docsUrl: 'https://francetravail.io/data/api/offres-emploi',
    fields: [
      { name: 'FRANCETRAVAIL_CLIENT_ID', label: 'Client ID', secret: false },
      { name: 'FRANCETRAVAIL_CLIENT_SECRET', label: 'Client secret', secret: true },
    ],
  },
  {
    service: 'sapling',
    label: 'Sapling',
    description: 'Optional AI-text detector for drafts.',
    docsUrl: 'https://sapling.ai/docs',
    fields: [{ name: 'SAPLING_KEY', label: 'API key', secret: true }],
  },
  {
    service: 'google_cse',
    label: 'Google Programmable Search',
    description: 'Finds company hiring emails on the web (100 free queries a day).',
    docsUrl: 'https://developers.google.com/custom-search/v1/overview',
    fields: [
      { name: 'GOOGLE_CSE_KEY', label: 'API key', secret: true },
      { name: 'GOOGLE_CSE_CX', label: 'Search engine ID (cx)', secret: false },
    ],
  },
  {
    service: 'telegram',
    label: 'Telegram bot',
    description: 'Phone notifications and the control bot (a bot from @BotFather and your chat id).',
    docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    fields: [
      { name: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', secret: true },
      { name: 'TELEGRAM_CHAT_ID', label: 'Chat ID', secret: false },
    ],
  },
  {
    service: 'ntfy',
    label: 'ntfy',
    description: 'Phone notifications through ntfy (a long random topic name).',
    docsUrl: 'https://docs.ntfy.sh/',
    fields: [
      { name: 'NTFY_TOPIC', label: 'Topic', secret: true },
      { name: 'NTFY_SERVER', label: 'Server', secret: false, optional: true },
      { name: 'NTFY_TOKEN', label: 'Access token', secret: true, optional: true },
    ],
  },
  {
    service: 'smtp',
    label: 'SMTP mailbox',
    description: 'Send applications from a non-Gmail mailbox (replies are read over IMAP).',
    docsUrl: 'https://nodemailer.com/smtp/',
    fields: [
      { name: 'SMTP_HOST', label: 'Host', secret: false },
      { name: 'SMTP_PORT', label: 'Port', secret: false, optional: true },
      { name: 'SMTP_USER', label: 'User', secret: false },
      { name: 'SMTP_PASS', label: 'Password', secret: true },
      { name: 'SMTP_FROM', label: 'From address', secret: false },
    ],
  },
]

const BY_SERVICE = new Map(SERVICE_DEFS.map((d) => [d.service, d]))

export function getServiceDef(service: string): ServiceDef | undefined {
  return BY_SERVICE.get(service)
}

/** Service + field for an environment variable name (the importer uses this). */
export function serviceForEnvName(name: string): { service: string; field: string } | null {
  for (const d of SERVICE_DEFS) for (const f of d.fields) if (f.name === name) return { service: d.service, field: f.name }
  return null
}

export type ServiceValues = Record<string, string>

/** Values with every required field filled, or null. */
export function completeValues(def: ServiceDef, values: Record<string, string | undefined>): ServiceValues | null {
  const out: ServiceValues = {}
  for (const f of def.fields) {
    const v = values[f.name]?.trim()
    if (v) out[f.name] = v
    else if (!f.optional) return null
  }
  return out
}

/** Last 4 characters of the first secret field (never the whole value). */
export function serviceHint(def: ServiceDef, values: ServiceValues): string {
  const f = def.fields.find((x) => x.secret && values[x.name]) ?? def.fields.find((x) => values[x.name])
  const v = f ? values[f.name] : ''
  return v.length <= 4 ? '****' : v.slice(-4)
}
