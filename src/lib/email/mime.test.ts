import { describe, expect, it } from 'vitest'
import { buildMime, fromBase64Url, textToHtml, toBase64Url } from './mime'

describe('buildMime', () => {
  it('builds a plain text message with standard headers', () => {
    const { raw, messageId } = buildMime({ from: { name: 'Alex Rivera', email: 'me@example.com' }, to: 'jobs@acme.ie', subject: 'Senior Engineer', text: 'Hello there' })
    expect(raw).toContain('From: "Alex Rivera" <me@example.com>')
    expect(raw).toContain('To: jobs@acme.ie')
    expect(raw).toContain('Subject: Senior Engineer')
    expect(raw).toContain(`Message-ID: ${messageId}`)
    expect(messageId).toMatch(/^<.+@example\.com>$/)
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(raw).toContain(Buffer.from('Hello there').toString('base64'))
  })
  it('encodes non-ASCII subjects and nests html + attachments', () => {
    const { raw } = buildMime({
      from: { name: 'Zoë', email: 'me@example.com' },
      to: 'a@b.c',
      subject: 'Café rôle',
      text: 'x',
      html: '<p>x</p>',
      attachments: [{ filename: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4') }],
      inReplyTo: '<abc@x>',
      references: ['<abc@x>'],
    })
    expect(raw).toContain('Subject: =?UTF-8?B?')
    expect(raw).toContain('multipart/mixed')
    expect(raw).toContain('multipart/alternative')
    expect(raw).toContain('Content-Disposition: attachment; filename="cv.pdf"')
    expect(raw).toContain('In-Reply-To: <abc@x>')
    expect(raw).toContain('References: <abc@x>')
  })
  it('round-trips base64url', () => {
    const s = 'héllo wörld ✓'
    expect(fromBase64Url(toBase64Url(s))).toBe(s)
    expect(toBase64Url(s)).not.toMatch(/[+/=]/)
  })
  it('turns text into simple html paragraphs', () => {
    const html = textToHtml('a < b\n\nsecond\nline')
    expect(html).toContain('a &lt; b')
    expect(html.match(/<p /g)?.length).toBe(2)
    expect(html).toContain('second<br>line')
  })
})
