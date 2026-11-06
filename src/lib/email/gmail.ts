import { google, type gmail_v1 } from 'googleapis'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { htmlToText } from '@/lib/text'
import { fromBase64Url, toBase64Url } from './mime'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
]

export const GMAIL_LABEL = 'job-pilot'

export function gmailRedirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, '')}/api/gmail/callback`
}

function oauthClient() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set')
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, gmailRedirectUri())
}

/**
 * A fixed account applications must be sent from. There is none: the sender is whichever Gmail
 * account the owner connects (OAuthToken.accountEmail), so Connect Gmail accepts any account.
 */
export function expectedGmailSender(): string | null {
  return null
}

export function getGmailAuthUrl(state: string): string {
  // "select_account" shows Google's account chooser even when the browser is signed in to another account.
  return oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'select_account consent', scope: GMAIL_SCOPES, state, include_granted_scopes: true, ...(expectedGmailSender() ? { login_hint: expectedGmailSender()! } : {}) })
}

export async function handleGmailCallback(code: string): Promise<{ email: string }> {
  const client = oauthClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and connect again.')
  client.setCredentials(tokens)
  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const email = profile.data.emailAddress ?? ''
  const expected = expectedGmailSender()
  if (expected && email.toLowerCase() !== expected) {
    await client.revokeToken(tokens.access_token ?? tokens.refresh_token).catch(() => undefined)
    throw new Error(`You picked ${email}, but applications must be sent from ${expected}. Click Connect Gmail again and choose ${expected} in Google's account list.`)
  }
  await db.oAuthToken.upsert({
    where: { provider: 'gmail' },
    update: {
      accountEmail: email,
      encryptedRefreshToken: encryptSecret(tokens.refresh_token),
      encryptedAccessToken: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    },
    create: {
      provider: 'gmail',
      accountEmail: email,
      encryptedRefreshToken: encryptSecret(tokens.refresh_token),
      encryptedAccessToken: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    },
  })
  return { email }
}

export async function disconnectGmail(): Promise<void> {
  await db.oAuthToken.deleteMany({ where: { provider: 'gmail' } })
}

export async function gmailConnection() {
  const t = await db.oAuthToken.findUnique({ where: { provider: 'gmail' } })
  return t ? { email: t.accountEmail, connectedAt: t.createdAt, scopes: t.scopes } : null
}

export async function getGmailClient(): Promise<{ gmail: gmail_v1.Gmail; email: string }> {
  const t = await db.oAuthToken.findUnique({ where: { provider: 'gmail' } })
  if (!t) throw new Error('Gmail is not connected')
  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptSecret(t.encryptedRefreshToken) })
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      void db.oAuthToken
        .update({ where: { provider: 'gmail' }, data: { encryptedAccessToken: encryptSecret(tokens.access_token), accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null } })
        .catch(() => undefined)
    }
  })
  return { gmail: google.gmail({ version: 'v1', auth: client }), email: t.accountEmail ?? '' }
}

export async function gmailSend(raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
  const { gmail } = await getGmailClient()
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: toBase64Url(raw), ...(threadId ? { threadId } : {}) } })
  const id = res.data.id ?? ''
  const tid = res.data.threadId ?? threadId ?? ''
  void applyLabel(id).catch(() => undefined)
  return { id, threadId: tid }
}

let labelIdCache: string | null = null

async function ensureLabelId(gmail: gmail_v1.Gmail): Promise<string | null> {
  if (labelIdCache) return labelIdCache
  const list = await gmail.users.labels.list({ userId: 'me' })
  const found = list.data.labels?.find((l) => l.name === GMAIL_LABEL)
  if (found?.id) return (labelIdCache = found.id)
  const created = await gmail.users.labels.create({ userId: 'me', requestBody: { name: GMAIL_LABEL, labelListVisibility: 'labelShow', messageListVisibility: 'show' } })
  return (labelIdCache = created.data.id ?? null)
}

export async function applyLabel(messageId: string): Promise<void> {
  const { gmail } = await getGmailClient()
  const labelId = await ensureLabelId(gmail)
  if (!labelId) return
  await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: [labelId] } })
}

export interface GmailMessageLite {
  id: string
  threadId: string
  messageIdHeader: string | null
  inReplyTo: string | null
  from: string
  to: string
  /** Cc header, when present (people copied in on a reply). */
  cc: string | null
  subject: string
  date: Date | null
  text: string
  labelIds: string[]
}

function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string | null {
  const h = payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

function extractText(part: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  const out = { text: '', html: '' }
  if (!part) return out
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    const mime = p.mimeType ?? ''
    if (p.body?.data && (mime === 'text/plain' || mime === 'text/html')) {
      const decoded = fromBase64Url(p.body.data)
      if (mime === 'text/plain') out.text += decoded
      else out.html += decoded
    }
    for (const c of p.parts ?? []) walk(c)
  }
  walk(part)
  return out
}

export function toLite(m: gmail_v1.Schema$Message): GmailMessageLite {
  const { text, html } = extractText(m.payload)
  const dateHeader = header(m.payload, 'Date')
  const date = m.internalDate ? new Date(Number(m.internalDate)) : dateHeader ? new Date(dateHeader) : null
  return {
    id: m.id ?? '',
    threadId: m.threadId ?? '',
    messageIdHeader: header(m.payload, 'Message-ID') ?? header(m.payload, 'Message-Id'),
    inReplyTo: header(m.payload, 'In-Reply-To'),
    from: header(m.payload, 'From') ?? '',
    to: header(m.payload, 'To') ?? '',
    cc: header(m.payload, 'Cc'),
    subject: header(m.payload, 'Subject') ?? '',
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text: (text || htmlToText(html) || m.snippet || '').trim(),
    labelIds: m.labelIds ?? [],
  }
}

export async function gmailGetThread(threadId: string): Promise<GmailMessageLite[]> {
  const { gmail } = await getGmailClient()
  const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' })
  return (res.data.messages ?? []).map(toLite)
}

export async function gmailTestConnection(): Promise<{ email: string; messagesTotal: number }> {
  const { gmail } = await getGmailClient()
  const p = await gmail.users.getProfile({ userId: 'me' })
  return { email: p.data.emailAddress ?? '', messagesTotal: p.data.messagesTotal ?? 0 }
}
