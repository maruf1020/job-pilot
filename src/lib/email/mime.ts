import { nanoid } from 'nanoid'

export interface MailAttachment {
  filename: string
  mimeType: string
  data: Buffer
}

export interface MailInput {
  from: { name: string; email: string }
  to: string
  cc?: string
  subject: string
  text: string
  html?: string
  attachments?: MailAttachment[]
  inReplyTo?: string
  references?: string[]
  messageId?: string
  headers?: Record<string, string>
}

const CRLF = '\r\n'

function encodeHeaderValue(value: string): string {
  // RFC 2047 for non-ASCII, otherwise raw
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeAddress(name: string, email: string): string {
  const n = name.trim()
  if (!n) return email
  const safe = /^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/"/g, '\\"')}"` : encodeHeaderValue(n)
  return `${safe} <${email}>`
}

function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, `$1${CRLF}`)
}

export function makeMessageId(domain: string): string {
  return `<${Date.now().toString(36)}.${nanoid(16)}@${domain}>`
}

/** Minimal text → HTML twin (paragraphs + line breaks), so mail clients render nicely. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 1em 0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Build a raw RFC 5322 message (multipart when there is HTML or attachments). */
export function buildMime(input: MailInput): { raw: string; messageId: string } {
  const domain = input.from.email.split('@')[1] ?? 'localhost'
  const messageId = input.messageId ?? makeMessageId(domain)
  const headers: string[] = [
    `From: ${encodeAddress(input.from.name, input.from.email)}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references?.length ? [`References: ${input.references.join(' ')}`] : []),
    ...Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${encodeHeaderValue(v)}`),
  ]

  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(input.text, 'utf8').toString('base64'))].join(CRLF)
  const htmlPart = input.html
    ? ['Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(input.html, 'utf8').toString('base64'))].join(CRLF)
    : null

  let body: string
  if (!htmlPart && !input.attachments?.length) {
    body = textPart
  } else {
    const altBoundary = `alt_${nanoid(12)}`
    const alternative = htmlPart
      ? [`Content-Type: multipart/alternative; boundary="${altBoundary}"`, '', `--${altBoundary}`, textPart, `--${altBoundary}`, htmlPart, `--${altBoundary}--`].join(CRLF)
      : textPart
    if (!input.attachments?.length) {
      body = alternative
    } else {
      const mixBoundary = `mix_${nanoid(12)}`
      const parts = [`Content-Type: multipart/mixed; boundary="${mixBoundary}"`, '', `--${mixBoundary}`, alternative]
      for (const a of input.attachments) {
        parts.push(
          `--${mixBoundary}`,
          [`Content-Type: ${a.mimeType}; name="${a.filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.filename}"`, '', wrap76(a.data.toString('base64'))].join(CRLF),
        )
      }
      parts.push(`--${mixBoundary}--`)
      body = parts.join(CRLF)
    }
  }
  return { raw: headers.join(CRLF) + CRLF + body + CRLF, messageId }
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf8')
}
