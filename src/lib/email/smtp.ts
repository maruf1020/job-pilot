import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { smtpConfig } from '@/lib/keys/service-keys'
import type { MailInput } from './mime'

/**
 * SMTP send + IMAP reply lookup for a non-Gmail mailbox. Assumes the IMAP host is
 * the SMTP host with `smtp.` swapped for `imap.` unless SMTP_HOST already starts with imap.
 */

export async function smtpSend(input: MailInput, raw: string): Promise<{ messageId: string }> {
  const smtp = await smtpConfig()
  if (!smtp) throw new Error('SMTP is not configured')
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  const info = await transport.sendMail({ envelope: { from: input.from.email, to: [input.to, ...(input.cc ? [input.cc] : [])] }, raw })
  return { messageId: input.messageId ?? info.messageId }
}

function imapHost(smtpHost: string): string {
  const h = smtpHost
  if (/^imap\./i.test(h)) return h
  return h.replace(/^smtp\./i, 'imap.')
}

export interface ImapReply {
  messageId: string
  inReplyTo: string | null
  references: string[]
  from: string
  to: string
  subject: string
  date: Date | null
  text: string
}

/** Find replies whose In-Reply-To / References mention any of our Message-IDs. */
export async function imapFindReplies(ourMessageIds: string[], since: Date): Promise<ImapReply[]> {
  const smtp = await smtpConfig()
  if (!smtp || ourMessageIds.length === 0) return []
  const client = new ImapFlow({
    host: imapHost(smtp.host),
    port: 993,
    secure: true,
    auth: { user: smtp.user, pass: smtp.pass },
    logger: false,
  })
  const out: ImapReply[] = []
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ since }, { uid: true })
      const wanted = new Set(ourMessageIds.map((m) => m.replace(/[<>]/g, '')))
      for await (const msg of client.fetch(uids && uids.length ? uids : [], { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue
        const parsed = await simpleParser(msg.source)
        const refs = ([] as string[]).concat(parsed.references ?? []).map((r) => r.replace(/[<>]/g, ''))
        const irt = parsed.inReplyTo?.replace(/[<>]/g, '') ?? null
        if (!(irt && wanted.has(irt)) && !refs.some((r) => wanted.has(r))) continue
        out.push({
          messageId: parsed.messageId ?? `imap-${msg.uid}`,
          inReplyTo: irt ? `<${irt}>` : null,
          references: refs.map((r) => `<${r}>`),
          from: parsed.from?.text ?? '',
          to: Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : (parsed.to?.text ?? ''),
          subject: parsed.subject ?? '',
          date: parsed.date ?? null,
          text: (parsed.text ?? '').trim(),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => undefined)
  }
  return out
}
