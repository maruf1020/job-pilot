import { db } from '@/lib/db'
import { getGmailClient, toLite, type GmailMessageLite } from '@/lib/email/gmail'

/**
 * Read one-time codes and verification links that application sites email to you
 * (Greenhouse "security code", Workday "verify your account"). Read-only Gmail access.
 */

export async function gmailConnected(): Promise<boolean> {
  return Boolean(await db.oAuthToken.findUnique({ where: { provider: 'gmail' }, select: { id: true } }))
}

export async function gmailSearch(q: string, max = 10): Promise<GmailMessageLite[]> {
  const { gmail } = await getGmailClient()
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: max })
  const out: GmailMessageLite[] = []
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue
    const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' })
    out.push(toLite(full.data))
  }
  return out
}

/** A code-like token near the word "code" (letters+digits or 4-10 digits). Pure, unit-tested. */
export function extractCode(text: string): string | null {
  const t = text.replace(/\r/g, '')
  const looksLikeCode = (s: string) => /^[A-Za-z0-9]{4,10}$/.test(s) && /\d/.test(s) && !/^(19|20)\d{2}$/.test(s)
  // "...security code field on your application: X5yt8bZq", "Your code is 123456", "Code: 4821":
  // check every word in the 160 characters after each "code".
  for (const m of t.matchAll(/\b(?:code|passcode|pin|otp)\b/gi)) {
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 160).split('\n\n')[0]
    for (const word of after.split(/[^A-Za-z0-9]+/)) if (looksLikeCode(word)) return word
  }
  // A line that is only the code, after the first "code". Greenhouse codes are 8 mixed-case
  // letters that sometimes hold no digit ("AAAaAAaA"): mixed case with a capital inside counts too.
  const first = t.search(/\b(?:code|passcode|otp)\b/i)
  for (const line of t.slice(Math.max(0, first)).split('\n')) {
    const s = line.trim()
    if (s.length < 6) continue
    if (looksLikeCode(s) || (/^[A-Za-z]{6,10}$/.test(s) && /[A-Z]/.test(s.slice(1)) && /[a-z]/.test(s))) return s
  }
  return null
}

/** Code emails already used: parallel agents must never enter another application's code. */
const usedCodeMessages = new Set<string>()

/** Whether an email is about this company ("Security code for your application to Workwize"). */
export function mentionsCompany(text: string, company: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const name = norm(company).replace(/\b(gmbh|ltd|limited|inc|bv|b v|ag|se|sa|plc|llc|group)\b/g, '').trim()
  if (!name) return true
  return ` ${norm(text)} `.includes(` ${name} `) || ` ${norm(text)} `.includes(` ${name.split(' ')[0]} `)
}

/** Wait for a code email that arrived after `since` (for `about`, the company you are applying to). */
export async function waitForEmailCode(opts: { since: Date; timeoutMs?: number; from?: RegExp; about?: string; aliases?: string[]; log?: (m: string) => void }): Promise<string | null> {
  if (!(await gmailConnected())) return null
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
  // The board may name the company differently ("Fin" on Intercom's board): the page title's name counts too.
  const names = [opts.about, ...(opts.aliases ?? [])].filter((n): n is string => !!n && n.trim().length > 1)
  // Narrow search (last hour, this company): several agents poll at once and Gmail has a quota.
  // Only the first word of the name: the email says "...application to Sword" for "Sword Health".
  const words = [...new Set(names.map((n) => n.replace(/["()]/g, ' ').trim().split(/\s+/)[0]).filter(Boolean))]
  const query = `newer_than:1h (code OR verification OR verify OR security OR passcode)${words.length ? ` (${words.map((w) => `"${w}"`).join(' OR ')})` : ''}`
  while (Date.now() < deadline) {
    let backoff = 6000
    const msgs = await gmailSearch(query, 5).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      opts.log?.(`Gmail search failed: ${msg.slice(0, 120)}`)
      // Gmail's per-minute quota is shared with the reply poller and the inbox scan: wait it out.
      if (/quota|rate limit|429/i.test(msg)) backoff = 20_000
      return []
    })
    for (const m of msgs) {
      if (!m.date || m.date.getTime() < opts.since.getTime() - 60_000) continue
      if (usedCodeMessages.has(m.id)) continue
      if (opts.from && !opts.from.test(`${m.from} ${m.subject}`)) continue
      if (names.length && !names.some((n) => mentionsCompany(`${m.subject}\n${m.text.slice(0, 2000)}`, n))) continue
      const code = extractCode(`${m.subject}\n${m.text}`)
      if (code) {
        usedCodeMessages.add(m.id)
        opts.log?.(`found a code in "${m.subject.slice(0, 80)}"`)
        return code
      }
    }
    await new Promise((r) => setTimeout(r, backoff))
  }
  return null
}

/** Link emails already used: two agents must never open each other's confirmation link. */
const usedLinkMessages = new Set<string>()

/** The link in an email that points at `host`, preferring confirm/verify links. Pure, unit-tested. */
export function pickEmailLink(text: string, host: RegExp): string | null {
  const links = (text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []).map((l) => l.replace(/[.,;]+$/, ''))
  return links.find((l) => host.test(l) && /verif|activat|confirm|token|code/i.test(l)) ?? links.find((l) => host.test(l)) ?? null
}

/**
 * Wait for an email with a link on `host`, arrived after `since`: Workday account verification, or a
 * Teamtailor "confirm your application" link. With `about`, only emails naming that company count; with
 * `maxAgeMs`, only emails that young (a confirmation link is for this application, not an old one).
 */
export async function waitForEmailLink(opts: { since: Date; host: RegExp; timeoutMs?: number; about?: string; maxAgeMs?: number; log?: (m: string) => void }): Promise<string | null> {
  if (!(await gmailConnected())) return null
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000)
  const word = opts.about?.replace(/["()]/g, ' ').trim().split(/\s+/)[0]
  // Confirmation emails come in the company's language ("Conclua a candidatura", "Bewerbung bestätigen").
  const query = `newer_than:1d (verify OR verification OR activate OR confirm OR confirme OR conclua OR confirmar OR bestätigen OR bevestig OR candidatura OR application)${word ? ` "${word}"` : ''}`
  while (Date.now() < deadline) {
    const msgs = await gmailSearch(query, 8).catch(() => [])
    for (const m of msgs) {
      if (!m.date || m.date.getTime() < opts.since.getTime() - 60_000) continue
      if (opts.maxAgeMs && Date.now() - m.date.getTime() > opts.maxAgeMs) continue
      if (usedLinkMessages.has(m.id)) continue
      if (opts.about && !mentionsCompany(`${m.subject}
${m.from}
${m.text.slice(0, 3000)}`, opts.about)) continue
      const link = pickEmailLink(m.text, opts.host)
      if (link) {
        usedLinkMessages.add(m.id)
        opts.log?.(`found a link in "${m.subject.slice(0, 80)}"`)
        return link
      }
    }
    await new Promise((r) => setTimeout(r, 7000))
  }
  return null
}
