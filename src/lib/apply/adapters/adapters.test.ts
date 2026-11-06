import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from '../__fixtures__/server'
import { pickEmailLink } from '../email-codes'
import { cvVariantFor, cvVariantPath } from '../files'
import { isNameNotResolved, networkUp } from '../network'
import { scanPage } from '../navigate'
import { turnstilePending, waitForTurnstile } from '../turnstile'
import { adapterFor, alwaysCaptcha, laneFor, runsInYourChrome, triageKey, vendorFormUrl } from './index'
import { customQuestionCount, greenhouseRef, parseGreenhouseQuestions, prefetchedKnockout } from './greenhouse'

describe('vendor adapters', () => {
  it('recognises the systems behind posting and form URLs', () => {
    expect(adapterFor('https://job-boards.greenhouse.io/datadog/jobs/123')?.id).toBe('greenhouse')
    expect(adapterFor('https://careers.datadoghq.com/detail/8257324/?gh_jid=8257324')?.id).toBe('greenhouse')
    expect(adapterFor('https://jobs.eu.lever.co/kpler/23e9e7db-ca92-4663-8b60-eed96c3859f1')?.id).toBe('lever')
    expect(adapterFor('https://nfon.jobs.personio.com/job/2810428')?.id).toBe('personio')
    expect(adapterFor('https://swanky.bamboohr.com/careers/165')?.id).toBe('bamboohr')
    expect(adapterFor('https://mainfyld.applytojob.com/apply/Hbk3Bu6T0d/React-Developer')?.id).toBe('jazzhr')
    expect(adapterFor('https://careers.stripe.com/jobs/123')).toBeNull()
  })

  it('goes straight to the form where the system has a fixed pattern', () => {
    expect(vendorFormUrl('https://nfon.jobs.personio.com/job/2810428?language=en')).toBe('https://nfon.jobs.personio.com/job/2810428/apply')
    expect(vendorFormUrl('https://nfon.jobs.personio.com/job/2810428/apply')).toBe('https://nfon.jobs.personio.com/job/2810428/apply')
    expect(vendorFormUrl('https://elockers.recruitee.com/o/senior-back-end-developer-1?source=Arbeitnow')).toBe('https://elockers.recruitee.com/o/senior-back-end-developer-1/c/new')
    expect(vendorFormUrl('https://jobs.lever.co/kpler/23e9e7db-ca92-4663-8b60-eed96c3859f1')).toBe('https://jobs.lever.co/kpler/23e9e7db-ca92-4663-8b60-eed96c3859f1/apply')
    expect(vendorFormUrl('https://jobs.ashbyhq.com/reflow/1fb90633-e2b4-4560-a421-b08016b08c1d')).toBe('https://jobs.ashbyhq.com/reflow/1fb90633-e2b4-4560-a421-b08016b08c1d/application')
    expect(vendorFormUrl('https://swanky.bamboohr.com/careers/165')).toBeNull()
  })

  it('knows where a batch should run and what always needs a person', () => {
    expect(runsInYourChrome('https://jobs.lever.co/kpler/23e9e7db-ca92-4663-8b60-eed96c3859f1')).toBe(true)
    expect(runsInYourChrome('https://nfon.jobs.personio.com/job/2810428')).toBe(true)
    expect(runsInYourChrome('https://job-boards.greenhouse.io/datadog/jobs/123')).toBe(false)
    expect(alwaysCaptcha('https://swanky.bamboohr.com/careers/165')).toBe(true)
    expect(alwaysCaptcha('https://jobs.ashbyhq.com/reflow/x')).toBe(false)
  })

  it('tracks shared systems per company and company sites per host', () => {
    expect(triageKey('https://jobs.lever.co/kpler/23e9e7db-ca92-4663-8b60-eed96c3859f1/apply')).toBe('jobs.lever.co/kpler')
    expect(triageKey('https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=123')).toBe('job-boards.greenhouse.io/stripe')
    expect(triageKey('https://join.com/companies/pflegia/16859038-senior-software-engineer')).toBe('join.com/pflegia')
    expect(triageKey('https://www.welcometothejungle.com/en/companies/acme/jobs/dev')).toBe('welcometothejungle.com/acme')
    expect(triageKey('https://nfon.jobs.personio.com/job/2810428/apply')).toBe('nfon.jobs.personio.com')
    expect(triageKey('https://careers.stripe.com/jobs/1')).toBe('careers.stripe.com')
    expect(triageKey('not a url')).toBeNull()
  })

  it('names the lane', () => {
    expect(laneFor('https://job-boards.greenhouse.io/x/jobs/1', { batch: true })).toBe('ats')
    expect(laneFor('https://careers.stripe.com/jobs/1', { batch: true })).toBe('other')
    expect(laneFor('https://www.linkedin.com/jobs/view/1/', { batch: true })).toBe('linkedin')
    expect(laneFor('https://job-boards.greenhouse.io/x/jobs/1', { batch: false })).toBe('single')
  })
})

describe('Greenhouse question prefetch', () => {
  const body = {
    questions: [
      { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
      { label: 'Resume/CV', required: true, fields: [{ name: 'resume', type: 'input_file', values: [] }] },
      { label: 'Will you require sponsorship?', required: true, fields: [{ name: 'q1', type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
      { label: 'Which country do you currently live in?', required: true, fields: [{ name: 'q2', type: 'multi_value_single_select', values: [{ label: 'Germany' }, { label: 'Spain' }, { label: 'Portugal' }] }] },
    ],
    location_questions: [{ label: 'Latitude', required: true, fields: [{ name: 'latitude', type: 'input_hidden', values: [] }] }],
  }

  it('finds the board token and job id', () => {
    expect(greenhouseRef('https://job-boards.greenhouse.io/datadog/jobs/8257324')).toEqual({ token: 'datadog', id: '8257324' })
    expect(greenhouseRef('https://x.example/careers', [{ source: 'ats', externalId: 'greenhouse:elastic:8276134', url: '' }])).toEqual({ token: 'elastic', id: '8276134' })
    expect(greenhouseRef('https://careers.datadoghq.com/detail/1/?gh_jid=8257324', [], 'datadog')).toEqual({ token: 'datadog', id: '8257324' })
    expect(greenhouseRef('https://careers.datadoghq.com/detail/1/?gh_jid=8257324')).toBeNull()
  })

  it('stops early when a required residence list leaves out the country of the person', () => {
    const q = parseGreenhouseQuestions(body)
    expect(q).toHaveLength(5)
    expect(customQuestionCount(q)).toBe(2)
    expect(prefetchedKnockout(q, 'Nigeria')).toMatch(/^Not eligible: "Which country do you currently live in\?" only offers Germany, Spain, Portugal/)
    const withOther = parseGreenhouseQuestions({ questions: [{ label: 'Where are you based?', required: true, fields: [{ type: 'multi_value_single_select', values: [{ label: 'Germany' }, { label: 'Spain' }, { label: 'Other' }] }] }] })
    expect(prefetchedKnockout(withOther, 'Nigeria')).toBeNull()
    const sponsorship = parseGreenhouseQuestions({ questions: [body.questions[2]] })
    expect(prefetchedKnockout(sponsorship, 'Nigeria')).toBeNull()
  })
})

describe('CV variants', () => {
  it('picks the version by title family', () => {
    expect(cvVariantFor('Senior Full-Stack Engineer (React/Node)')).toBe('fullstack')
    expect(cvVariantFor('Senior Frontend Engineer')).toBe('frontend')
    expect(cvVariantFor('React Developer')).toBe('frontend')
    expect(cvVariantFor('Backend Engineer, Payments API')).toBe('backend')
    expect(cvVariantFor('Senior Node.js Developer')).toBe('backend')
    expect(cvVariantFor('Software Engineer II')).toBe('fullstack')
  })

  it('uses the PDF in the variant folder, if any', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cvv-'))
    expect(cvVariantPath('frontend', base)).toBeNull()
    fs.mkdirSync(path.join(base, 'cv', 'variants', 'frontend'), { recursive: true })
    fs.writeFileSync(path.join(base, 'cv', 'variants', 'frontend', 'Alex-Rivera-CV.pdf'), '%PDF-1.4')
    expect(cvVariantPath('frontend', base)).toBe(path.join(base, 'cv', 'variants', 'frontend', 'Alex-Rivera-CV.pdf'))
    expect(cvVariantPath('backend', base)).toBeNull()
  })
})

describe('network and email helpers', () => {
  it('tells a dead name from other errors', () => {
    expect(isNameNotResolved('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.example')).toBe(true)
    expect(isNameNotResolved('page.goto: net::ERR_CONNECTION_TIMED_OUT')).toBe(false)
  })

  it('sees the network as down only when every check name fails', async () => {
    expect(await networkUp(async () => undefined)).toBe(true)
    expect(await networkUp(async (h) => (h === 'microsoft.com' ? undefined : Promise.reject(new Error('ENOTFOUND'))))).toBe(true)
    expect(await networkUp(async () => Promise.reject(new Error('ENOTFOUND')))).toBe(false)
  })

  it('picks the confirmation link on the right site', () => {
    const text = 'Hi Md, please confirm: https://click.mail.example/track?u=1 or https://careers.axians.pt/applications/confirm?token=abc123. Thanks'
    expect(pickEmailLink(text, /^https?:\/\/([a-z0-9-]+\.)*(careers\.axians\.pt|teamtailor\.com)(\/|$)/i)).toBe('https://careers.axians.pt/applications/confirm?token=abc123')
    expect(pickEmailLink('nothing here https://other.example/x', /teamtailor\.com/)).toBeNull()
  })
})

describe('Turnstile waits (local fixture pages)', () => {
  let server: FixtureServer
  let browser: Browser
  beforeAll(async () => {
    server = await startFixtureServer()
    browser = await chromium.launch({ headless: true })
  })
  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  it('waits for a token that arrives by itself', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/turnstile/pass`)
    const { scan } = await scanPage(page)
    expect(scan.captcha?.kind).toBe('turnstile')
    expect(await turnstilePending(page)).toBe(true)
    expect(await waitForTurnstile(page, 8000)).toBe(true)
    expect(await turnstilePending(page)).toBe(false)
    await page.close()
  })

  it('gives up on a token that never comes', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/turnstile/stuck`)
    expect(await waitForTurnstile(page, 2000)).toBe(false)
    await page.close()
  })
})
