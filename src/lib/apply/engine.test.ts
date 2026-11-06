import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFixtureServer, type FixtureServer } from './__fixtures__/server'
import type { AnswerBank } from './answer-bank'
import type { PlannedAnswer, ScannedField } from './types'
import { extensionContexts } from '@/lib/browser/chrome'
import { applyPlan, fillField, loadChoiceOptions } from './fill'
import { clickAndFollow, findApplicationForm, relevantFields, scanPage } from './navigate'
import { planAnswers, type PlanContext } from './plan'

// End-to-end test of the agent engine (read form → plan → fill → submit) on local fake sites.
// No database, no network beyond 127.0.0.1, and the AI is a stub.

const STD: Record<string, string> = {
  first_name: 'Sam',
  last_name: 'Okafor',
  preferred_name: 'Sam',
  phone: '+2348020000000',
  phone_country: 'Nigeria',
  city: 'Lagos',
  country: 'Nigeria',
  region: 'Lagos State',
  linkedin: 'https://www.linkedin.com/in/sam-okafor-example',
  github: 'https://github.com/sam-okafor-example',
  website: 'https://github.com/sam-okafor-example',
  notice_period: '1 month',
  requires_sponsorship: 'Yes',
  work_authorization: 'I am a citizen of Nigeria based in Lagos, Nigeria. I do not hold a work permit for this country yet and would need visa sponsorship (for example a Skilled Worker visa in the UK).',
  willing_to_relocate: 'Yes',
  how_heard: 'Online job search',
  gender: '',
  pronouns: '',
}
const bank: AnswerBank = { rows: [], std: (k) => STD[k.replace(/^std:/, '')] ?? null, lookup: () => null }

let server: FixtureServer
let browser: Browser
let resumePath: string
const aiSeen: string[] = []

function ctx(): PlanContext {
  return {
    bank,
    email: 'applicant@example.org',
    fullName: 'Sam Okafor',
    yearsExperience: 5.5,
    coverLetter: null,
    resumePath,
    coverLetterPath: null,
    coverLetterEverywhere: false,
    profile: { fullName: 'Sam Okafor', headline: 'Lead Software Engineer', location: 'Lagos, Nigeria', yearsExperience: 5.5, summary: '', skills: ['TypeScript', 'Node.js', 'PostgreSQL'], facts: [], titles: [], stopSkills: [], experience: [], mindset: null, salaryExpectation: null },
    job: { id: 'j', title: 'Senior Software Engineer', company: 'Acme', location: 'Dublin', countryCode: 'IE', url: '', description: '', summary: null, mustHaveSkills: [], sponsorship: 'unknown', sponsorshipEvidence: [], hook: null },
    company: 'Acme',
    useAi: true,
    primaryOk: false,
    remember: false,
    aiAnswer: async (fields) => {
      aiSeen.push(...fields.map((f) => f.label))
      return fields.map((f) => {
        if (/why do you want/i.test(f.label)) return { key: f.key, value: 'I have built payment flows in TypeScript and Node.js for five years, and Acme works on exactly that.', choices: null, needsHuman: false, reason: null }
        if (/work arrangement/i.test(f.label)) return { key: f.key, value: 'Hybrid', choices: null, needsHuman: false, reason: null }
        if (/used in production/i.test(f.label)) return { key: f.key, value: null, choices: ['Node.js', 'PostgreSQL'], needsHuman: false, reason: null }
        return { key: f.key, value: null, choices: null, needsHuman: f.required, reason: 'not in the profile' }
      })
    },
  }
}

async function fillCurrentPage(page: Page) {
  const { scan, frames } = await scanPage(page)
  const fields = relevantFields(scan)
  for (const f of fields) {
    if ((f.kind === 'combobox' || f.kind === 'listbox') && f.options.length === 0) {
      f.options = (await loadChoiceOptions(frames[f.frame ?? 0], f, 'f0o')).map((label) => ({ label }))
      if (f.options.length) f.asyncOptions = false
    }
  }
  const plan = await planAnswers(fields, ctx())
  const result = await applyPlan(frames, fields, plan.answers, () => undefined)
  return { scan, fields, plan, result }
}

async function pressButton(page: Page, kind: 'submit' | 'next') {
  const { scan, frames } = await scanPage(page)
  const b = scan.buttons.find((x) => x.kind === kind && x.visible && !x.disabled)
  expect(b, `${kind} button`).toBeTruthy()
  await clickAndFollow(page, frames, b!)
}

beforeAll(async () => {
  server = await startFixtureServer()
  browser = await chromium.launch({ headless: true })
  resumePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jf-')), 'Test-CV.pdf')
  fs.writeFileSync(resumePath, '%PDF-1.4\n% test cv\n')
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('browser apply engine on fake sites', () => {
  it('reads a Greenhouse-style form correctly', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/gh/jobs/1`)
    const { scan } = await scanPage(page)
    const byId = (id: string) => scan.fields.find((f) => f.id === id)
    expect(byId('first_name')).toMatchObject({ kind: 'text', label: 'First Name', required: true })
    expect(byId('resume')).toMatchObject({ kind: 'file', label: 'Resume/CV', required: true })
    expect(byId('q_sponsor')).toMatchObject({ kind: 'combobox', required: true })
    expect(byId('q_location')).toMatchObject({ kind: 'combobox', asyncOptions: true })
    expect(byId('years')?.options.map((o) => o.label)).toEqual(['0-2 years', '3-5 years', '5-7 years', '8+ years'])
    expect(byId('consent')).toMatchObject({ kind: 'checkbox', required: true })
    expect(scan.buttons.find((b) => b.kind === 'submit')?.text).toBe('Submit application')
    expect(scan.captcha).toBeNull()
    await page.close()
  }, 60_000)

  it('fills and submits a Greenhouse-style form with the right answers', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/gh/jobs/1`)
    const found = await findApplicationForm(page, { log: () => undefined, job: { title: 'Senior Software Engineer', company: 'Acme' }, useAi: false })
    expect(found.status).toBe('form')
    const { plan, result } = await fillCurrentPage(page)
    expect(plan.open).toEqual([])
    expect(result.failed).toEqual([])
    await pressButton(page, 'submit')
    expect((await scanPage(page)).scan.successText).toMatch(/thank you for applying/i)
    const body = server.submissions.find((s) => s.path === '/submit/gh')!.body
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1]
    expect(field('first_name')).toBe('Sam')
    expect(field('last_name')).toBe('Okafor')
    expect(field('email')).toBe('applicant@example.org')
    expect(field('phone')).toBe('+2348020000000')
    expect(field('linkedin')).toBe('https://www.linkedin.com/in/sam-okafor-example')
    expect(field('twitter')).toBe('')
    expect(field('q_sponsor')).toBe('Yes')
    expect(field('q_location')).toBe('Lagos, Lagos State, Nigeria')
    expect(field('q_heard')).toBe('Job board')
    expect(field('years')).toBe('5-7 years')
    expect(field('why')).toMatch(/payment flows/)
    expect(field('gender')).toBe('decline')
    expect(field('consent')).toBe('on')
    expect(body).not.toMatch(/name="news"/)
    expect(body).toMatch(/filename="Test-CV\.pdf"/)
    // The AI was asked only what the rules could not answer.
    expect(aiSeen).toEqual(['Why do you want to work at Acme?'])
    await page.close()
  }, 90_000)

  it('follows the Apply link from a posting and handles yes/no buttons, radios and checkbox groups', async () => {
    aiSeen.length = 0
    const page = await browser.newPage()
    await page.goto(`${server.base}/post/2`)
    const found = await findApplicationForm(page, { log: () => undefined, job: { title: 'Backend Engineer', company: 'Beta' }, useAi: false })
    expect(found.status).toBe('form')
    expect(found.page.url()).toBe(`${server.base}/ashby/2/application`)
    const { plan, result } = await fillCurrentPage(found.page)
    expect(plan.open).toEqual([])
    expect(result.failed).toEqual([])
    await pressButton(found.page, 'submit')
    const body = server.submissions.find((s) => s.path === '/submit/ashby')!.body
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1]
    expect(field('_systemfield_name')).toBe('Sam Okafor')
    expect(field('relocate')).toBe('Yes')
    expect(field('arrangement')).toBe('hybrid')
    expect(body.match(/name="stack"\r\n\r\n(\w+)/g)?.map((m) => m.split('\r\n\r\n')[1])).toEqual(['node', 'postgres'])
    expect(aiSeen.sort()).toEqual(['Preferred work arrangement', 'Which of these have you used in production?'])
    await found.page.close()
  }, 90_000)

  it('reads an Ashby checkbox group as one required question', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/ashby/groups`)
    const { scan } = await scanPage(page)
    const group = scan.fields.find((f) => /already in Munich/.test(f.label))
    expect(group).toMatchObject({ kind: 'checkboxes', required: true })
    expect(group?.options.map((o) => o.label)).toEqual(['I live in London', 'I live in Munich', 'I would be willing to relocate to Munich'])
    expect(scan.fields.filter((f) => f.kind === 'checkbox')).toEqual([])
    await page.close()
  })

  it('ticks the one box of a single-answer Ashby checkbox group (years of experience)', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/ashby/groups`)
    const { plan } = await fillCurrentPage(page)
    expect(plan.answers.find((a) => /how many years/i.test(a.label))).toMatchObject({ choices: ['5-10 years'] })
    expect(await page.isChecked('#q2-2')).toBe(true)
    expect(await page.isChecked('#q2-1')).toBe(false)
    await page.close()
  })

  it('reads only the open modal form, not the page behind it (LinkedIn Easy Apply)', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/modal/apply`)
    const { scan } = await scanPage(page)
    expect(scan.fields.map((f) => f.label)).toEqual(['Email address', 'Phone country code', 'Mobile phone number'])
    expect(scan.buttons.find((b) => b.text === 'Next')?.kind).toBe('next')
    await page.close()
  })

  it('walks a three-step wizard and answers from the saved details', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/wiz/1`)
    for (const step of [1, 2]) {
      const { plan, result } = await fillCurrentPage(page)
      expect(plan.open, `step ${step}`).toEqual([])
      expect(result.failed, `step ${step}`).toEqual([])
      await pressButton(page, 'next')
    }
    expect(server.submissions.find((s) => s.path === '/wiz/2')?.body).toMatch(/notice=1\+month&auth=No/)
    const last = await fillCurrentPage(page)
    expect(last.result.failed).toEqual([])
    await pressButton(page, 'submit')
    expect(server.submissions.find((s) => s.path === '/submit/wiz')?.body).toBe('terms=on')
    await page.close()
  }, 90_000)

  it('fills Workable-style ARIA radios, read-only dropdowns and checkbox groups truthfully', async () => {
    aiSeen.length = 0
    const page = await browser.newPage()
    await page.goto(`${server.base}/workable/j/1/apply/`)
    const { scan } = await scanPage(page)
    const byLabel = (re: RegExp) => scan.fields.find((f) => re.test(f.label))
    // One question with four options, not four unrelated checkboxes.
    expect(byLabel(/know anyone/)).toMatchObject({
      kind: 'checkboxes',
      required: true,
      label: 'Do you know anyone who works at (or is in the process of joining) Acme Group? (Please select all that apply)',
    })
    expect(byLabel(/know anyone/)?.options).toHaveLength(4)
    expect(scan.fields.filter((f) => f.kind === 'checkbox').map((f) => f.label)).toEqual([expect.stringMatching(/^I have read, understand and accept/)])
    expect(byLabel(/require sponsorship/)).toMatchObject({ kind: 'radio', required: true, options: [{ label: 'YES' }, { label: 'NO' }] })
    // The "*" lives next to the label, the real required input is hidden next to the dropdown.
    expect(byLabel(/hear about/)).toMatchObject({ kind: 'combobox', required: true })

    const { fields, plan, result } = await fillCurrentPage(page)
    // Each dropdown shows only its own options, even while the previous list is still closing.
    expect(fields.find((f) => /KPMG/.test(f.label))?.options.map((o) => o.label)).toEqual(['Yes', 'No'])
    expect(plan.open).toEqual([])
    expect(result.failed).toEqual([])
    expect(aiSeen).toEqual([])

    // The page shows the answers (state read from the ARIA wrappers, not the hidden inputs).
    const after = (await scanPage(page)).scan.fields
    const valueOf = (re: RegExp) => after.find((f) => re.test(f.label))?.value
    expect(valueOf(/require sponsorship/)).toBe('YES')
    expect(valueOf(/previously worked/)).toBe('NO')
    expect(valueOf(/without requiring sponsorship/)).toBe('NO')
    expect(valueOf(/know anyone/)).toBe("No - I don't know anyone who works at or is joining Acme Group")
    expect(valueOf(/hear about/)).toBe('Acme Careers Page')

    await pressButton(page, 'submit')
    const body = server.submissions.find((s) => s.path === '/submit/workable')!.body
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1]
    expect(field('firstname')).toBe('Sam')
    expect(field('email')).toBe('applicant@example.org')
    expect(field('CA_1')).toBe('true') // needs sponsorship: yes
    expect(field('CA_2')).toBe('None yet - I would need visa sponsorship')
    expect(field('CA_3')).toBe('false') // worked there before: no
    expect(field('CA_4')).toBe('Acme Careers Page')
    expect(field('CA_5_0')).toBe('on') // knows nobody there
    expect(body).not.toMatch(/name="CA_5_[123]"/)
    expect(field('CA_6')).toBe('No')
    expect(field('CA_7')).toBe('false') // right to work without sponsorship: no
    expect(field('gdpr')).toBe('on')
    expect(body).toMatch(/filename="Test-CV\.pdf"/)
    await page.close()
  }, 120_000)

  it('stops for a person on a visible CAPTCHA', async () => {
    const page = await browser.newPage()
    await page.goto(`${server.base}/captcha`)
    const found = await findApplicationForm(page, { log: () => undefined, job: { title: 'x', company: 'y' }, useAi: false })
    expect(found.status).toBe('captcha')
    await page.close()
  }, 60_000)

  it('sees a Turnstile checkbox in a closed shadow root and an hCaptcha challenge marked aria-hidden', async () => {
    const page = await browser.newPage()
    await page.setContent(`<form><label for="e">Email</label><input id="e" type="email"><button type="submit">Submit application</button>
      <div id="ts" style="width:300px;height:65px"><input type="hidden" name="cf-turnstile-response" value=""></div></form>
      <script>document.getElementById('ts').attachShadow({ mode: 'closed' }).innerHTML = '<div style="width:300px;height:65px">Verify you are human</div>'</script>`)
    expect((await scanPage(page)).scan.captcha).toMatchObject({ kind: 'turnstile', challengeVisible: true })
    // Solved: Turnstile fills the token box.
    await page.evaluate(() => ((document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement).value = 'token'))
    expect((await scanPage(page)).scan.captcha).toBeNull()
    await page.setContent(`<form><label for="e">Email</label><input id="e" type="email"></form>
      <div aria-hidden="true"><iframe src="${server.base}/hcaptcha.com/captcha/v1/static/hcaptcha.html#frame=challenge" width="400" height="580"></iframe></div>`)
    expect((await scanPage(page)).scan.captcha).toMatchObject({ kind: 'hcaptcha', challengeVisible: true })
    await page.close()
  }, 60_000)

  it('sees an hCaptcha puzzle by its frame title and a script-driven "Apply" as the submit button', async () => {
    const page = await browser.newPage()
    await page.setContent(`<form><label for="e">Email</label><input id="e" type="email"></form>
      <div><iframe title="Main content of the hCaptcha challenge" src="about:blank" width="400" height="580"></iframe></div>`)
    expect((await scanPage(page)).scan.captcha).toMatchObject({ kind: 'hcaptcha', challengeVisible: true })
    // Lever's enclave frame: hidden until a puzzle opens.
    await page.setContent(`<form><label for="e">Email</label><input id="e" type="email"></form>
      <iframe id="en" title="Widget containing checkbox for hCaptcha security challenge" src="${server.base}/hcaptcha.com/captcha/v1/static/hcaptcha-enclave.html#frame=en" width="1200" height="800" style="visibility:hidden"></iframe>`)
    expect((await scanPage(page)).scan.captcha).toBeNull()
    await page.evaluate(() => ((document.getElementById('en') as HTMLElement).style.visibility = 'visible'))
    expect((await scanPage(page)).scan.captcha).toMatchObject({ kind: 'hcaptcha', challengeVisible: true })
    // Lever after its hidden check failed: only a banner, the puzzle comes with the next Submit.
    await page.setContent('<form><p class="error">✱ There was an error verifying your application. Please try again.</p><button type="submit">Submit application</button></form>')
    expect((await scanPage(page)).scan.captcha).toMatchObject({ kind: 'hcaptcha', challengeVisible: true })
    // Arbeitnow: type="button" Apply inside the form, a hidden anti-spam box next to the real ones.
    await page.setContent(`<form><label for="fn">First name</label><input id="fn" name="first_name"><label for="em">Email address</label><input id="em" type="email" name="email">
      <label for="cv">CV / Resume</label><input id="cv" type="file" name="cv_or_resume"><input type="text" name="arbeitnow_name_x" style="display:none">
      <button type="button" id="button_send_application">Apply</button></form><button type="button">Share</button>`)
    const { scan } = await scanPage(page)
    expect(scan.buttons.find((b) => b.text === 'Apply')?.kind).toBe('submit')
    // Never filled: the planner skips fields that are not visible.
    expect(scan.fields.find((f) => /arbeitnow_name/.test(f.name))?.visible ?? false).toBe(false)
    await page.setContent('<main><p>Your job application has been sent successfully. Good luck!</p></main>')
    expect((await scanPage(page)).scan.successText).toMatch(/job application has been sent/i)
    await page.close()
  }, 60_000)

  it('reads a web-component button by its slotted text and a "Resume" section upload as the CV', async () => {
    const page = await browser.newPage()
    await page.setContent(`<form><label for="e">Email*</label><input id="e" type="email" required>
      <section><h3>Resume</h3><label for="cv">Choose a file or drop it here</label><input id="cv" type="file"></section>
      <spl-button id="next">Next</spl-button></form>
      <script>document.getElementById('next').attachShadow({ mode: 'open' }).innerHTML = '<button type="button"><slot></slot></button>'</script>`)
    const { scan } = await scanPage(page)
    expect(scan.buttons.find((b) => b.text === 'Next')?.kind).toBe('next')
    const plan = await planAnswers(relevantFields(scan), ctx())
    expect(plan.answers.find((a) => a.kind === 'file')).toMatchObject({ source: 'resume' })
    await page.close()
  }, 60_000)

  it('sees a ticked "I am not a robot" box as answered by its token', async () => {
    const { captchaAnswered } = await import('./navigate')
    const page = await browser.newPage()
    await page.setContent('<form><input name="email"><textarea name="g-recaptcha-response" style="display:none"></textarea><button>Submit</button></form>')
    expect(await captchaAnswered(page)).toBe(false)
    await page.evaluate(() => ((document.querySelector('textarea') as HTMLTextAreaElement).value = '03AFcWeA7x'.repeat(5)))
    expect(await captchaAnswered(page)).toBe(true)
    await page.close()
  }, 60_000)

  it('signs in through the Workday "Sign In" pop-up that sits over the create-account form', async () => {
    const { signInDialog } = await import('./workday')
    const page = await browser.newPage()
    // Vanguard: the create form stays underneath with its own email and two password boxes.
    await page.setContent(`<form id="create"><input data-automation-id="email" id="ce"><input type="password" id="cp1"><input type="password" id="cp2"><button type="button">Create Account</button></form>
      <div role="dialog"><h2>Sign In</h2><input data-automation-id="email" id="de"><input type="password" id="dp">
        <button data-automation-id="signInSubmitButton" type="button" onclick="document.body.dataset.signedIn = document.getElementById('de').value">Sign In</button></div>`)
    expect(await signInDialog(page, 'a@example.org', 'pw-123')).toBe(true)
    expect(await page.inputValue('#dp')).toBe('pw-123')
    expect(await page.inputValue('#cp1')).toBe('')
    expect(await page.evaluate(() => document.body.dataset.signedIn)).toBe('a@example.org')
    // No pop-up: nothing is touched.
    await page.setContent('<form><input type="password"><button>Sign In</button></form>')
    expect(await signInDialog(page, 'a@example.org', 'pw')).toBe(false)
    await page.close()
  }, 60_000)

  it('reads SmartRecruiters screening questions whose web-component label is only "*"', async () => {
    const page = await browser.newPage()
    // As on AJ Bell / Tieto: the question text sits in the container; the component's own label is "*".
    await page.setContent(`<form>
      <div data-test="question-container"><div>Are you currently employed?</div><sr-text id="q1"></sr-text></div>
      <div data-test="question-container"><sr-select id="q2" aria-label="Select Tell us where you saw this job vacancy."></sr-select></div>
      </form>
      <script>
        document.getElementById('q1').attachShadow({ mode: 'open' }).innerHTML = '<label slot="label" for="i1"><span>*</span></label><input id="i1" type="text" required>'
        document.getElementById('q2').attachShadow({ mode: 'open' }).innerHTML = '<label slot="label" for="i2">*</label><input id="i2" role="combobox" required>'
      </script>`)
    const { scan } = await scanPage(page)
    const labels = scan.fields.map((f) => f.label)
    expect(labels).toContain('Are you currently employed?')
    expect(labels).toContain('Tell us where you saw this job vacancy.')
    expect(labels).not.toContain('*')
    await page.close()
  }, 60_000)

  it('uploads from inside the page in Chrome reached through the Playwright extension', async () => {
    const context = await browser.newContext()
    extensionContexts.add(context)
    const page = await context.newPage()
    await page.goto(`${server.base}/gh/jobs/1`)
    const { result } = await fillCurrentPage(page)
    expect(result.failed).toEqual([])
    await pressButton(page, 'submit')
    const body = server.submissions.filter((s) => s.path === '/submit/gh').at(-1)!.body
    expect(body).toMatch(/filename="Test-CV\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.4/)

    // A widget that ignores its input and only takes a dropped file.
    await page.setContent(`<div id="zone"><input id="f" type="file" data-jf-key="k1" style="display:none"><button type="button">Upload</button><span id="shown"></span></div>
      <script>document.getElementById('zone').addEventListener('drop', (e) => { e.preventDefault(); document.getElementById('shown').textContent = e.dataTransfer.files[0].name })</script>`)
    const field = { key: 'k1', kind: 'file', label: 'Resume', required: true, options: [] } as unknown as ScannedField
    expect(await fillField(page.mainFrame(), field, { file: resumePath } as PlannedAnswer, 'x')).toEqual({ ok: true })
    expect(await page.textContent('#shown')).toBe('Test-CV.pdf')
    await context.close()
  }, 90_000)

  it('turns questions nobody can answer into open questions', async () => {
    const page = await browser.newPage()
    await page.setContent('<form><label for="lic">Driving licence number*</label><input id="lic" required><label for="e">Email</label><input id="e" type="email"><button type="submit">Submit application</button></form>')
    const { plan } = await fillCurrentPage(page)
    expect(plan.open.map((q) => q.label)).toEqual(['Driving licence number'])
    await page.close()
  }, 60_000)
})
