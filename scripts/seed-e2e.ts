/**
 * Extra demo rows for the end-to-end tests of the newer screens (Needs you, Hosts, Inbox next steps,
 * Not hiring from abroad). Refuses to run unless DATABASE_URL names a database ending in "_e2e".
 * Idempotent. Usage (through the e2e wrapper): node scripts/e2e-env.mjs npx tsx scripts/seed-e2e.ts
 */
process.loadEnvFile('.env')

async function main() {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://x/none').pathname.replace(/^\//, '')
  if (!dbName.endsWith('_e2e')) throw new Error(`Refusing to seed "${dbName}": not an e2e database`)
  const { db } = await import('@/lib/db')
  const { buildDedupeKey } = await import('@/lib/pipeline/dedupe')
  const { normalizeCompany } = await import('@/lib/text')
  const { hashPassword } = await import('@/lib/auth/password')
  const now = Date.now()
  const day = 86_400_000

  // The e2e owner: a fictional person, already through onboarding (the onboarding flow has its own spec).
  const e2eName = process.env.E2E_USERNAME ?? 'Alex Rivera'
  const e2ePassword = process.env.E2E_PASSWORD ?? 'e2e-password-123'
  await db.user.upsert({
    where: { username: e2eName.toLowerCase() },
    update: { passwordHash: await hashPassword(e2ePassword), onboardedAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    create: { username: e2eName.toLowerCase(), name: e2eName, email: 'alex.rivera@example.com', passwordHash: await hashPassword(e2ePassword), onboardedAt: new Date() },
  })
  const alex = {
    fullName: 'Alex Rivera',
    headline: 'Senior Software Engineer',
    email: 'alex.rivera@example.com',
    phone: '912 345 678',
    phoneCountryCode: '+351',
    location: 'Lisbon, Portugal',
    city: 'Lisbon',
    country: 'PT',
    timezone: 'Europe/Lisbon',
    citizenships: ['PT'],
    pronouns: 'they/them',
    givenName: 'Alex',
    familyName: 'Rivera',
    preferredName: 'Alex',
    profession: 'software',
    seniority: ['senior'],
    yearsExperience: 7,
    summary: 'Builds web products end to end with TypeScript, React and Node.js; leads a small team.',
    skills: ['TypeScript', 'React', 'Next.js', 'Node.js', 'PostgreSQL', 'AWS'],
    titles: ['Senior Software Engineer', 'Senior Frontend Engineer', 'Full Stack Engineer'],
    facts: ['leads a team of 10 engineers', 'built a booking platform used by 40 clinics', 'cut page load time by 60%', 'runs production workloads on AWS'],
    stopSkills: ['PHP'],
    languages: ['English', 'Portuguese'],
    languageLevels: [
      { name: 'English', level: 'fluent' },
      { name: 'Portuguese', level: 'native' },
    ],
    workAuth: { needsSponsorship: false, rightToWork: [], authorizationText: 'EU citizen (Portugal): no visa needed in the EU.' },
    relocation: 'yes',
    remote: 'ok',
    experience: [
      { company: 'Northwind Labs', title: 'Senior Software Engineer', from: '2021', to: null, bullets: ['Leads a team of 10 engineers'] },
      { company: 'Contoso Digital', title: 'Software Engineer', from: '2018', to: '2021', bullets: ['Built a booking platform used by 40 clinics'] },
    ],
    education: [{ school: 'University of Lisbon', degree: 'BSc Computer Science', year: 2018 }],
    degree: "Bachelor's",
    emailVoice: { tone: 'warm', neverMention: [], leadWith: ['React', 'Node.js'], signOff: 'Kind regards,' },
  }
  await db.candidateProfile.upsert({ where: { id: 1 }, update: alex, create: { id: 1, ...alex } })
  // What the onboarding form's Finish does: search queries, keywords and title rules from the profile.
  const { applyProfileToSettings } = await import('@/lib/settings/derive')
  await applyProfileToSettings({ countries: ['PT', 'ES', 'DE', 'NL', 'IE', 'GB'], includeRemote: true })

  const company = async (name: string, countryCode: string) => {
    const row = await db.company.upsert({
      where: { normalizedName: normalizeCompany(name) },
      update: {},
      create: { name, normalizedName: normalizeCompany(name), countryCode },
    })
    return row.id
  }

  const job = async (j: { id: string; title: string; company: string; countryCode: string; location: string; status: string; score: number | null; filterReason?: string; url: string }) => {
    const companyId = await company(j.company, j.countryCode)
    const dedupeKey = buildDedupeKey(j.company, j.title, j.countryCode)
    await db.job.upsert({
      where: { dedupeKey },
      update: { status: j.status, filterReason: j.filterReason ?? null, finalScore: j.score },
      create: {
        id: j.id,
        dedupeKey,
        title: j.title,
        companyId,
        companyName: j.company,
        url: j.url,
        location: j.location,
        countryCode: j.countryCode,
        description: `${j.title} at ${j.company}. TypeScript, React and Node.js on AWS. Demo posting for the end-to-end tests.`,
        postedAt: new Date(now - 3 * day),
        firstSeenAt: new Date(now - 3 * day),
        primarySource: 'ats',
        sponsorship: 'unknown',
        applyChannel: 'portal',
        seniority: 'senior',
        status: j.status,
        filterReason: j.filterReason ?? null,
        finalScore: j.score,
        sourceLinks: { create: { source: 'ats', externalId: j.id, url: j.url } },
      },
    })
    const id = (await db.job.findUniqueOrThrow({ where: { dedupeKey }, select: { id: true } })).id
    if (j.score != null) {
      await db.jobScore.upsert({
        where: { jobId: id },
        update: { finalScore: j.score },
        create: { jobId: id, ruleScore: j.score, llmScore: j.score, finalScore: j.score, breakdown: [{ label: 'Demo score', points: j.score }], reasons: [], gaps: [], model: 'demo' },
      })
    }
    return id
  }

  // A form that stopped at a CAPTCHA (Needs you → CAPTCHA forms).
  const captchaJob = await job({ id: 'demo-job-6', title: 'Senior React Developer', company: 'Demo Cloud GmbH', countryCode: 'DE', location: 'Berlin, Germany', status: 'RANKED', score: 77, url: 'https://demo-captcha.example/jobs/6' })
  await db.application.upsert({
    where: { jobId: captchaJob },
    update: { status: 'NEEDS_HUMAN', portalStatus: 'NEEDS_HUMAN', sentAt: null },
    create: { id: 'demo-app-captcha', jobId: captchaJob, channel: 'portal', status: 'NEEDS_HUMAN', portalStatus: 'NEEDS_HUMAN' },
  })
  await db.portalAttempt.upsert({
    where: { id: 'demo-attempt-captcha' },
    update: {},
    create: {
      id: 'demo-attempt-captcha',
      applicationId: 'demo-app-captcha',
      mode: 'submit',
      status: 'NEEDS_HUMAN',
      startUrl: 'https://demo-captcha.example/jobs/6',
      formUrl: 'https://demo-captcha.example/jobs/6/apply',
      host: 'demo-captcha.example',
      lane: 'other',
      needsHumanReason: 'CAPTCHA, waiting for you: open this application and press Fill in your Chrome; the agent fills the form and you solve the CAPTCHA.',
      startedAt: new Date(now - 2 * 3600_000),
      finishedAt: new Date(now - 2 * 3600_000 + 90_000),
    },
  })

  // Hosts the agent learned about (Hosts page, Needs you → sign-in walls).
  const hosts = [
    { host: 'demo-captcha.example', kind: 'captcha', attempts: 2, submitted: 0, needsHuman: 2, failed: 0, failStreak: 2, lastOutcome: 'NEEDS_HUMAN', lastReason: 'CAPTCHA, waiting for you' },
    { host: 'demo-signin.example', kind: 'sign-in-wall', attempts: 3, submitted: 0, needsHuman: 3, failed: 0, failStreak: 3, lastOutcome: 'NEEDS_HUMAN', lastReason: 'demo-signin.example asks you to sign in. Log in once in the apply browser.' },
    { host: 'jobs.lever.co/demo', kind: 'direct-form', attempts: 4, submitted: 3, needsHuman: 0, failed: 1, failStreak: 0, lastOutcome: 'SUBMITTED', lastReason: null },
  ]
  for (const h of hosts) await db.hostProfile.upsert({ where: { host: h.host }, update: h, create: h })

  // A question only you can answer (Needs you → questions).
  await db.answerBank.upsert({
    where: { key: 'demo e2e what is your notice period in weeks' },
    update: { answer: null },
    create: { key: 'demo e2e what is your notice period in weeks', question: 'Demo e2e: what is your notice period in weeks?', answer: null, kind: 'number', source: 'user' },
  })

  // A reply that turns down only the location (Inbox → Not hiring from abroad).
  const locationJob = await job({ id: 'demo-job-8', title: 'Frontend Engineer', company: 'Demo Health BV', countryCode: 'NL', location: 'Amsterdam, Netherlands', status: 'APPLIED', score: 72, url: 'https://example.com/jobs/demo-job-8' })
  await db.application.upsert({
    where: { jobId: locationJob },
    update: { status: 'REPLIED' },
    create: { id: 'demo-app-location', jobId: locationJob, channel: 'email', status: 'REPLIED', toEmail: 'careers@demo-health.example', threadId: 'demo-thread-2', sentAt: new Date(now - 8 * day), repliedAt: new Date(now - day) },
  })
  // Next steps and the abroad list hide senders on .example/.test domains (demo data in the real
  // database), so the e2e-only replies use made-up company domains. Nothing is ever sent from e2e.
  await db.emailMessage.upsert({
    where: { provider_providerMessageId: { provider: 'demo', providerMessageId: 'demo-in-3' } },
    update: { fromAddress: 'Sarah Recruiter <sarah@demofintech-e2e.io>' },
    create: {
      applicationId: 'demo-app-sent',
      direction: 'INBOUND',
      provider: 'demo',
      providerMessageId: 'demo-in-3',
      threadId: 'demo-thread-1',
      fromAddress: 'Sarah Recruiter <sarah@demofintech-e2e.io>',
      toAddress: 'me@example.com',
      subject: 'Re: Backend Engineer, TypeScript - next step',
      bodyText: 'Thanks Alex. Could you do a 45 minute technical interview next Tuesday at 14:00 Dublin time?',
      receivedAt: new Date(now - 3600_000),
      classification: 'INTERVIEW_REQUEST',
      classificationMeta: { classification: 'INTERVIEW_REQUEST', confidence: 0.95, summary: 'Technical interview proposed for next Tuesday at 14:00 Dublin time.' },
      isRead: false,
    },
  })
  await db.emailMessage.upsert({
    where: { provider_providerMessageId: { provider: 'demo', providerMessageId: 'demo-in-2' } },
    update: { fromAddress: 'Talent Team <careers@demohealth-e2e.nl>' },
    create: {
      applicationId: 'demo-app-location',
      direction: 'INBOUND',
      provider: 'demo',
      providerMessageId: 'demo-in-2',
      threadId: 'demo-thread-2',
      fromAddress: 'Talent Team <careers@demohealth-e2e.nl>',
      toAddress: 'me@example.com',
      subject: 'Re: Frontend Engineer application',
      bodyText: 'Thank you for applying. Unfortunately we can only hire people who already live in the Netherlands for this role.',
      receivedAt: new Date(now - day),
      classification: 'LOCATION_ISSUE',
      classificationMeta: { classification: 'LOCATION_ISSUE', confidence: 0.9, summary: 'They only hire people already living in the Netherlands.' },
      isRead: false,
    },
  })

  // A job dropped because, outside Europe, the posting does not say it sponsors.
  await job({ id: 'demo-job-7', title: 'Software Engineer', company: 'Demo Toronto Inc', countryCode: 'CA', location: 'Toronto, ON', status: 'FILTERED', score: null, filterReason: 'Canada: the posting does not say the employer sponsors a visa', url: 'https://example.com/jobs/demo-job-7' })

  // A disabled placeholder Gemini key, so the AI settings have a row (never a real key in the e2e database).
  const { encryptSecret, keyHint } = await import('@/lib/crypto')
  if (!(await db.aiKey.count({ where: { label: 'E2E placeholder key' } }))) {
    const fake = 'e2e-placeholder-not-a-real-key-0000'
    await db.aiKey.create({ data: { label: 'E2E placeholder key', provider: 'gemini', encryptedKey: encryptSecret(fake), keyHint: keyHint(fake), enabled: false, rpdLimit: 0 } })
  }

  console.log('e2e demo rows ready: demo-app-captcha, 3 hosts, 1 open question, demo-app-location, demo-job-7')
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
