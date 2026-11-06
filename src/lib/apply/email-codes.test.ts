import { describe, expect, it } from 'vitest'
import { extractCode, mentionsCompany } from './email-codes'

describe('codes in emails', () => {
  it('reads the Greenhouse security code', () => {
    expect(extractCode('Copy and paste this code into the security code field on your application: X5yt8bZq\nThanks')).toBe('X5yt8bZq')
  })
  it('reads a Greenhouse code with no digit in it', () => {
    const mail = 'Hi Alex,\r\nCopy and paste this code into the security code field on your application:\r\n\n\r\nKXPmQRtB\n\r\n\r\nAfter you enter the code, resubmit your application.\r\n\n© 2026 Greenhouse\r\n'
    expect(extractCode(mail)).toBe('KXPmQRtB')
  })
  it('reads plain numeric codes', () => {
    expect(extractCode('Your verification code is 482913. It expires in 10 minutes.')).toBe('482913')
    expect(extractCode('Code: 4821')).toBe('4821')
  })
  it('reads a code on its own line', () => {
    expect(extractCode('Hello,\nUse the following:\n\n  9KD72QX1  \n\nThe team')).toBe('9KD72QX1')
  })
  it('ignores years and plain words', () => {
    expect(extractCode('Thanks for applying in 2026. We will review your application code of conduct soon.')).toBeNull()
  })
})

describe('code emails for parallel agents', () => {
  it('matches the company the agent is applying to', () => {
    expect(mentionsCompany('Security code for your application to Workwize', 'Workwize')).toBe(true)
    expect(mentionsCompany('Security code for your application to Wolt - English', 'wolt')).toBe(true)
    expect(mentionsCompany('Security code for your application to GetYourGuide', 'GetYourGuide GmbH')).toBe(true)
  })
  it('ignores another company code', () => {
    expect(mentionsCompany('Security code for your application to Contentful', 'Nebius')).toBe(false)
  })
})
