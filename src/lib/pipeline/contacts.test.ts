import { describe, expect, it } from 'vitest'
import { parseSmtpReply } from '@/lib/email/verify'
import { crawlWebsiteForEmails, decodeCloudflareEmail, decodeObfuscatedEmails, domainForJob, extractJsonLdEmails, findEmailsOnWebsite, GUESS_LOCAL_PARTS, hostToDomain, isUsableContact } from './contacts'

describe('domainForJob', () => {
  it('prefers the company domain, then a non-aggregator posting host', () => {
    expect(domainForJob({ url: 'https://www.arbeitnow.com/view/x' }, { domain: 'https://acme.ie/about' })).toBe('acme.ie')
    expect(domainForJob({ url: 'https://boards.greenhouse.io/acme/jobs/1' }, {})).toBeNull()
    expect(domainForJob({ url: 'https://www.acme.ie/careers/1' }, {})).toBe('acme.ie')
    expect(domainForJob({ url: 'https://jooble.org/x', contactEmail: 'jobs@acme.ie' }, {})).toBe('acme.ie')
    expect(domainForJob({ url: 'https://jooble.org/x', contactEmail: 'someone@gmail.com' }, {})).toBeNull()
  })
  it('normalises hosts', () => {
    expect(hostToDomain('WWW.Acme.IE')).toBe('acme.ie')
  })
})

describe('obfuscated addresses', () => {
  it('decodes Cloudflare email protection', () => {
    // "jobs@acme.ie" xor key 0x5a
    const hex = ['5a', ...[...'jobs@acme.ie'].map((c) => (c.charCodeAt(0) ^ 0x5a).toString(16).padStart(2, '0'))].join('')
    expect(decodeCloudflareEmail(hex)).toBe('jobs@acme.ie')
    expect(decodeCloudflareEmail('zz')).toBeNull()
  })
  it('reads [at]/[dot], (at), entity and cloudflare forms', () => {
    const html = `<p>Write to careers [at] acme [dot] ie or hr (at) acme.ie. Also jobs&#64;acme.ie.</p>
      <a href="/cdn-cgi/l/email-protection#${['5a', ...[...'talent@acme.ie'].map((c) => (c.charCodeAt(0) ^ 0x5a).toString(16).padStart(2, '0'))].join('')}">mail</a>`
    const found = decodeObfuscatedEmails(html).sort()
    expect(found).toEqual(['careers@acme.ie', 'hr@acme.ie', 'jobs@acme.ie', 'talent@acme.ie'])
  })
  it('ignores prose that merely contains "at"', () => {
    expect(decodeObfuscatedEmails('<p>We met John at Dublin dot com festival</p>')).toEqual([])
  })
  it('extracts JSON-LD contact points', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","contactPoint":{"email":"recruiting@acme.ie"}}</script>`
    expect(extractJsonLdEmails(html)).toEqual(['recruiting@acme.ie'])
  })
})

describe('crawlWebsiteForEmails', () => {
  const site: Record<string, string> = {
    'https://acme.ie/': '<html><body><a href="/about/careers">Careers</a><a href="/contact">Contact us</a><a href="https://twitter.com/acme">Twitter</a></body></html>',
    'https://acme.ie/about/careers': '<html><body>Send your CV to <a href="mailto:careers@acme.ie">careers</a>. Press: press@acme.ie</body></html>',
    'https://acme.ie/contact': '<html><body>info@acme.ie</body></html>',
  }
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url)
    const html = site[u]
    return html ? new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  it('follows careers/contact links from the homepage and ranks recruiting addresses first', async () => {
    const r = await crawlWebsiteForEmails('acme.ie', fakeFetch)
    expect(r.pages).toBeGreaterThanOrEqual(3)
    const emails = r.candidates.map((c) => c.email)
    expect(emails).toContain('careers@acme.ie')
    expect(emails).toContain('info@acme.ie')
    expect(emails).not.toContain('press@acme.ie')
    expect((await findEmailsOnWebsite('acme.ie', fakeFetch))[0]).toBe('careers@acme.ie')
  })
  it('returns nothing when the site is unreachable', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await findEmailsOnWebsite('nowhere.invalid', dead)).toEqual([])
  })
})

describe('helpers', () => {
  it('starts guesses with careers@ and jobs@', () => {
    expect(GUESS_LOCAL_PARTS.slice(0, 2)).toEqual(['careers', 'jobs'])
  })
  it('rejects mailboxes that are wrong for applications', () => {
    expect(isUsableContact('candidateaccommodations@acme.ie')).toBe(false)
    expect(isUsableContact('careers@acme.ie')).toBe(true)
  })
  it('parses single and multi-line SMTP replies', () => {
    expect(parseSmtpReply('220 mx.acme.ie ESMTP\r\n')).toMatchObject({ code: 220, complete: true })
    expect(parseSmtpReply('250-mx.acme.ie\r\n250-SIZE 1000\r\n')).toMatchObject({ code: 250, complete: false })
    expect(parseSmtpReply('250-mx.acme.ie\r\n250 OK\r\n')).toMatchObject({ code: 250, complete: true })
    expect(parseSmtpReply('550 5.1.1 No such user\r\n')).toMatchObject({ code: 550, complete: true })
  })
})
