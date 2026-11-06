import { z } from 'zod'

/**
 * Environment validation shared by the Next.js app and the worker.
 * Empty strings are treated as "unset" so optional integrations stay optional.
 */
const optional = z.string().min(1).optional()

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  /** Direct (non-pooled) connection for migrations, pg-boss and the worker; falls back to DATABASE_URL. */
  DIRECT_DATABASE_URL: z.url().optional(),
  APP_URL: z.url().default('http://localhost:3012'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  APP_ENCRYPTION_KEY: z.string().min(32, 'APP_ENCRYPTION_KEY must be at least 32 characters'),
  /** Server clock zone for the worker's active hours; the owner's own time zone lives in Settings. */
  TZ: z.string().default('UTC'),

  /**
   * AI keys are added in Settings > AI keys. These (and any <PROVIDER>_API_KEY variable) are only an
   * optional source for the "Import from .env" button; they are never copied into the app on their own.
   */
  GEMINI_API_KEYS: optional,
  ANTHROPIC_API_KEY: optional,

  /** Optional Google OAuth app for "Sign in with Google" and Connect Gmail (the sender is the connected account). */
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  /** Worker pauses outside this window (e.g. "08:00-23:00", days "1-5") so a serverless DB can sleep. */
  WORKER_ACTIVE_HOURS: optional,
  WORKER_ACTIVE_DAYS: optional,
  /** "true" lets web requests probe mailboxes over SMTP (off on Lambda, where port 25 is blocked). */
  CONTACT_VERIFY_IN_WEB: optional,

  // Service credentials below are fallbacks: Settings > Keys (ServiceKey) wins when set there.
  ADZUNA_APP_ID: optional,
  ADZUNA_APP_KEY: optional,
  JOOBLE_KEY: optional,
  RAPIDAPI_KEY: optional,
  /** Reed.co.uk Jobseeker API key (UK jobs). */
  REED_KEY: optional,
  /** France Travail "Offres d'emploi v2" client credentials. */
  FRANCETRAVAIL_CLIENT_ID: optional,
  FRANCETRAVAIL_CLIENT_SECRET: optional,
  SAPLING_KEY: optional,
  /** Google Programmable Search (Custom Search JSON API) for finding company hiring emails. */
  GOOGLE_CSE_KEY: optional,
  GOOGLE_CSE_CX: optional,

  /** Phone notifications through ntfy (https://ntfy.sh): a long random topic name; anyone who knows it can read it. */
  NTFY_TOPIC: optional,
  NTFY_SERVER: z.url().default('https://ntfy.sh'),
  /** Access token for a protected topic or a self-hosted server (optional). */
  NTFY_TOKEN: optional,
  /** Or Telegram: a bot from @BotFather and your chat id. */
  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  /** Optional read-only Postgres role for the Telegram /ai queries (SELECT only); falls back to a READ ONLY transaction on DATABASE_URL. */
  AI_QUERY_DATABASE_URL: z.url().optional(),

  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: optional,
})

export type Env = z.infer<typeof schema>

function load(): Env {
  const raw: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) raw[k] = v === '' ? undefined : v
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  return parsed.data
}

export const env: Env = load()

/**
 * Every Gemini key from the environment: GEMINI_API_KEYS (comma, space or newline separated, any
 * number) plus older GEMINI_API_KEY_<n> variables if a .env still has them. Duplicates are dropped.
 */
export function geminiKeysFromEnv(source: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = []
  const add = (v: string | undefined) => {
    for (const k of (v ?? '').split(/[\s,;]+/)) if (k && !out.includes(k)) out.push(k)
  }
  add(source.GEMINI_API_KEYS)
  const numbered = Object.keys(source)
    .filter((k) => /^GEMINI_API_KEY_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))
  for (const k of numbered) add(source[k])
  return out
}

export const isGmailConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
/** SMTP set in .env only; smtpConfig() in '@/lib/keys/service-keys' also sees credentials entered in Settings. */
export const isSmtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM)
