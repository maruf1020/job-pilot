/**
 * Dry run of the browser agent on a real application form: open it, read it, plan the answers
 * and fill them, take a screenshot, then close. It NEVER presses Submit and writes nothing to
 * the database (no attempt, no application). AI is only called with --ai.
 *
 *   npm run portal:dry -- <jobId | url> [--headed] [--ai]
 */
if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* environment provided by the host */
  }
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => !a.startsWith('--'))
  if (!target) throw new Error('usage: npm run portal:dry -- <jobId | url> [--headed] [--ai]')
  const headed = args.includes('--headed')
  const useAi = args.includes('--ai')

  const path = await import('node:path')
  const { chromium } = await import('playwright')
  const { db } = await import('@/lib/db')
  const { loadAnswerBank } = await import('@/lib/apply/answer-bank')
  const { applyPlan, loadChoiceOptions } = await import('@/lib/apply/fill')
  const { resumeFilePath } = await import('@/lib/apply/files')
  const { findApplicationForm, relevantFields, scanPage } = await import('@/lib/apply/navigate')
  const { planAnswers } = await import('@/lib/apply/plan')
  const { formTarget } = await import('@/lib/apply/urls')
  const { adapterFor, vendorFormUrl } = await import('@/lib/apply/adapters')
  const { fetchGreenhouseQuestions, greenhouseRef, prefetchedKnockout, customQuestionCount } = await import('@/lib/apply/adapters/greenhouse')
  const { getProfileForPrompt } = await import('@/lib/pipeline/profile')
  const { toJobForPrompt } = await import('@/lib/pipeline/draft')

  let url = target
  let jobForPrompt
  let company = 'the company'
  let links: Array<{ source: string; externalId: string; url: string }> = []
  let companySlug: string | null = null
  if (!/^https?:\/\//.test(target)) {
    const job = await db.job.findUniqueOrThrow({ where: { id: target }, include: { score: true, company: true, sourceLinks: { select: { source: true, externalId: true, url: true } } } })
    const t = formTarget(job, job.sourceLinks)
    url = t.url
    links = job.sourceLinks
    companySlug = job.company.atsType === 'greenhouse' ? job.company.atsSlug : null
    jobForPrompt = toJobForPrompt(job)
    company = job.companyName
    console.log(`${job.title} at ${job.companyName} → ${t.site} → ${url}`)
  }
  // The same routing as a real attempt: straight to a known system's form, Greenhouse questions read first.
  const direct = vendorFormUrl(url)
  if (direct && direct !== url) {
    console.log(`straight to the form: ${direct}`)
    url = direct
  }
  const vendor = adapterFor(url)
  if (vendor) console.log(`system: ${vendor.label}, CAPTCHA: ${vendor.captcha}${vendor.preferYourChrome ? ', runs in your Chrome' : ''}, budget ${vendor.budgetMinutes} min`)
  const ref = vendor?.id === 'greenhouse' ? greenhouseRef(url, links, companySlug) : null
  if (ref) {
    const qs = await fetchGreenhouseQuestions(ref)
    if (qs) {
      console.log(`Greenhouse lists ${qs.length} question(s), ${customQuestionCount(qs)} beyond the contact details`)
      const ko = prefetchedKnockout(qs, (await loadAnswerBank()).std('country'))
      if (ko) console.log(`would stop before opening the page: ${ko}`)
    }
  }
  const profile = await getProfileForPrompt()
  jobForPrompt ??= { id: 'x', title: 'Software Engineer', company, location: null, countryCode: null, url, description: '', summary: null, mustHaveSkills: [], sponsorship: 'unknown', sponsorshipEvidence: [], hook: null }
  const email = (await db.candidateProfile.findUnique({ where: { id: 1 }, select: { email: true } }))?.email ?? ''

  const browser = await chromium.launch({ headless: !headed })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2500)
    const found = await findApplicationForm(page, { log: (m) => console.log(`  nav: ${m}`), job: { title: jobForPrompt.title, company }, useAi: false })
    console.log(`form search: ${found.status}${'reason' in found ? ` (${found.reason})` : ''}`)
    // Like a real attempt: a Turnstile under the form is filled first and waited for at Submit.
    const turnstileForm = found.status === 'captcha' && found.scan.captcha?.kind === 'turnstile'
    if (turnstileForm) console.log('Turnstile under the form: filling anyway (a real attempt waits for it at Submit)')
    if (found.status !== 'form' && !turnstileForm) return
    const { scan, frames } = await scanPage(found.page)
    const fields = relevantFields(scan)
    for (const f of fields) {
      if ((f.kind === 'combobox' || f.kind === 'listbox') && f.visible && f.options.length === 0) {
        f.options = (await loadChoiceOptions(frames[f.frame ?? 0], f, `f${f.frame ?? 0}o`)).map((label) => ({ label }))
        if (f.options.length) f.asyncOptions = false
      }
    }
    console.log(`\n${fields.length} fields, buttons: ${scan.buttons.filter((b) => b.kind !== 'other').map((b) => `${b.kind}:"${b.text}"`).join(', ')}${scan.captcha ? `, captcha: ${scan.captcha.kind}` : ''}`)
    const plan = await planAnswers(fields, {
      bank: await loadAnswerBank(),
      email,
      fullName: profile.fullName,
      yearsExperience: profile.yearsExperience,
      coverLetter: 'Dry run cover letter.',
      resumePath: await resumeFilePath(),
      coverLetterPath: null,
      coverLetterEverywhere: false,
      profile,
      job: jobForPrompt,
      company,
      useAi,
      primaryOk: false,
      remember: false,
      ...(useAi ? {} : { aiAnswer: async (fs) => fs.map((f) => ({ key: f.key, value: null, choices: null, needsHuman: false, reason: '(dry run without AI)' })) }),
    })
    for (const a of plan.answers) console.log(`  ✓ ${a.label.slice(0, 70)} = ${(a.file ? path.basename(a.file) : a.value).slice(0, 70)}  [${a.source}]`)
    for (const s of plan.skipped) console.log(`  - ${s.label.slice(0, 70)}  (${s.reason})`)
    for (const q of plan.open) console.log(`  ? ${q.label.slice(0, 70)}  (${q.reason})`)
    const r = await applyPlan(frames, fields, plan.answers, (m) => console.log(`  ! ${m}`))
    console.log(`\nfilled ${r.filled}, failed ${r.failed.length}. NOT submitted.`)
    const shot = path.resolve('storage', 'apply-shots', `dry-run-${Date.now()}.jpg`)
    await found.page.screenshot({ path: shot, fullPage: true, type: 'jpeg', quality: 55 })
    console.log(`screenshot: ${shot}`)
  } finally {
    await browser.close()
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

export {}
