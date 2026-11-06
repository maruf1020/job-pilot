/**
 * Deterministic demo dataset for end-to-end tests and screenshots.
 * Idempotent: everything is keyed by fixed ids/dedupe keys. Usage: npx tsx scripts/seed-demo.ts
 */
process.loadEnvFile('.env')

async function main() {
  const { db } = await import('@/lib/db')
  const { buildDedupeKey } = await import('@/lib/pipeline/dedupe')
  const { normalizeCompany } = await import('@/lib/text')

  const companies = [
    { name: 'Demo Fintech Ltd', countryCode: 'IE', knownSponsor: true, contactEmail: 'jobs@demo-fintech.example' },
    { name: 'Demo Cloud GmbH', countryCode: 'DE', knownSponsor: false, contactEmail: null },
    { name: 'Demo Health BV', countryCode: 'NL', knownSponsor: true, contactEmail: null },
  ]
  const companyIds: Record<string, string> = {}
  for (const c of companies) {
    const row = await db.company.upsert({
      where: { normalizedName: normalizeCompany(c.name) },
      update: { countryCode: c.countryCode, knownSponsor: c.knownSponsor, contactEmail: c.contactEmail },
      create: { name: c.name, normalizedName: normalizeCompany(c.name), countryCode: c.countryCode, knownSponsor: c.knownSponsor, contactEmail: c.contactEmail },
    })
    companyIds[c.name] = row.id
  }

  const now = Date.now()
  const day = 86_400_000
  const jobs = [
    { id: 'demo-job-1', title: 'Senior Frontend Engineer (React/TypeScript)', company: 'Demo Fintech Ltd', countryCode: 'IE', location: 'Dublin, Ireland', sponsorship: 'yes', channel: 'email', contactEmail: 'jobs@demo-fintech.example', score: 88, status: 'REVIEW', postedDaysAgo: 2, source: 'arbeitnow' },
    { id: 'demo-job-2', title: 'Full Stack Engineer, Node and React', company: 'Demo Cloud GmbH', countryCode: 'DE', location: 'Berlin, Germany', sponsorship: 'likely', channel: 'ats', contactEmail: null, score: 74, status: 'RANKED', postedDaysAgo: 5, source: 'ats' },
    { id: 'demo-job-3', title: 'Lead Software Engineer', company: 'Demo Health BV', countryCode: 'NL', location: 'Amsterdam, Netherlands', sponsorship: 'unknown', channel: 'portal', contactEmail: null, score: 61, status: 'RANKED', postedDaysAgo: 9, source: 'jooble' },
    { id: 'demo-job-4', title: 'Backend Engineer (TypeScript)', company: 'Demo Fintech Ltd', countryCode: 'IE', location: 'Cork, Ireland', sponsorship: 'yes', channel: 'email', contactEmail: 'jobs@demo-fintech.example', score: 81, status: 'APPLIED', postedDaysAgo: 12, source: 'adzuna' },
    { id: 'demo-job-5', title: 'Junior PHP Developer', company: 'Demo Cloud GmbH', countryCode: 'DE', location: 'Munich, Germany', sponsorship: 'unknown', channel: 'unknown', contactEmail: null, score: null, status: 'FILTERED', postedDaysAgo: 3, source: 'adzuna' },
  ] as const

  for (const j of jobs) {
    const dedupeKey = buildDedupeKey(j.company, j.title, j.countryCode)
    const description = `${j.title} at ${j.company}. We build products in TypeScript, React, Node.js and PostgreSQL. ${j.sponsorship === 'yes' ? 'We sponsor Critical Skills Employment Permits and offer relocation support. ' : ''}Apply${j.contactEmail ? ` by emailing ${j.contactEmail}` : ' via our careers portal'}. Requirements: 5+ years building web applications, strong TypeScript, experience leading small teams.`
    await db.job.upsert({
      where: { dedupeKey },
      update: { status: j.status, contactEmail: j.contactEmail, sponsorship: j.sponsorship, applyChannel: j.channel, finalScore: j.score },
      create: {
        id: j.id,
        dedupeKey,
        title: j.title,
        companyId: companyIds[j.company],
        companyName: j.company,
        url: `https://example.com/jobs/${j.id}`,
        location: j.location,
        countryCode: j.countryCode,
        description,
        postedAt: new Date(now - j.postedDaysAgo * day),
        firstSeenAt: new Date(now - j.postedDaysAgo * day),
        primarySource: j.source,
        sponsorship: j.sponsorship,
        sponsorshipEvidence: j.sponsorship === 'yes' ? ['We sponsor Critical Skills Employment Permits'] : [],
        applyChannel: j.channel,
        contactEmail: j.contactEmail,
        seniority: 'senior',
        mustHaveSkills: ['TypeScript', 'React', 'Node.js'],
        summary: 'Demo posting used by the end-to-end tests.',
        enrichedAt: j.status === 'FILTERED' ? null : new Date(),
        status: j.status,
        filterReason: j.status === 'FILTERED' ? 'Title contains "junior"' : null,
        finalScore: j.score,
        sourceLinks: { create: { source: j.source, externalId: j.id, url: `https://example.com/jobs/${j.id}` } },
      },
    })
    const jobRow = await db.job.findUniqueOrThrow({ where: { dedupeKey }, select: { id: true } })
    if (j.score != null) {
      await db.jobScore.upsert({
        where: { jobId: jobRow.id },
        update: { finalScore: j.score },
        create: {
          jobId: jobRow.id,
          ruleScore: j.score - 5,
          llmScore: j.score + 5,
          finalScore: j.score,
          breakdown: [
            { label: 'Sponsorship offered', points: 30 },
            { label: 'Priority country', points: 20 },
            { label: 'Title matches target roles', points: 15 },
            { label: 'AI fit score', points: j.score + 5, detail: 'weighted 40%' },
          ],
          reasons: ['Stack overlap on TypeScript, React and Node.js', 'Senior level matches 5+ years'],
          gaps: ['No fintech domain experience listed'],
          hook: 'Their merchant dashboard rebuild in React 19 lines up with the HRMS rebuild I led.',
          model: 'demo',
        },
      })
    }
  }

  // Applications: one in review with drafts, one sent with an inbound reply.
  const reviewJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: buildDedupeKey('Demo Fintech Ltd', 'Senior Frontend Engineer (React/TypeScript)', 'IE') } })
  const sentJob = await db.job.findUniqueOrThrow({ where: { dedupeKey: buildDedupeKey('Demo Fintech Ltd', 'Backend Engineer (TypeScript)', 'IE') } })

  const review = await db.application.upsert({
    where: { jobId: reviewJob.id },
    update: { status: 'REVIEW', toEmail: 'jobs@demo-fintech.example', scheduledFor: null, sentAt: null, notes: null },
    create: { id: 'demo-app-review', jobId: reviewJob.id, channel: 'email', status: 'REVIEW', toEmail: 'jobs@demo-fintech.example' },
  })
  const body = `Hi Demo Fintech Ltd team,\n\nYour posting for a Senior Frontend Engineer mentions rebuilding the merchant dashboard in React and TypeScript, which is close to what I spent the last two years on. At Northwind Labs I lead a team of 10 engineers and was the principal developer of an HRMS built in React and PostgreSQL.\n\nThe part that interests me most is keeping the old and new dashboards in step during the migration. We did the same with a Redux app last year, and the tricky bits were shared auth and feature flags, which I would enjoy comparing notes on.\n\nI'm based in Lisbon and can start within about six to eight weeks from an offer. Would a short call next week suit you?\n\nAlex Rivera`
  // Always start from the same two versions so the e2e suite is deterministic.
  await db.emailDraft.deleteMany({ where: { applicationId: review.id } })
  {
    await db.emailDraft.create({
      data: { applicationId: review.id, kind: 'initial', version: 1, subject: 'Senior Frontend Engineer, React and TypeScript', body: body.replace('Hi Demo', 'I hope this email finds you well. Hi Demo'), passed: false, isSelected: false, generatedBy: 'demo', lintResult: { passed: false, errors: [{ rule: 'banned-phrase', severity: 'error', message: 'Avoid "i hope this email finds you well"', match: 'I hope this email finds you well', where: 'body' }], warnings: [], stats: { words: 160, sentences: 9, paragraphs: 5, avgSentenceLen: 17, sentenceLenStdDev: 6, subjectChars: 44 } } },
    })
    await db.emailDraft.create({
      data: { applicationId: review.id, kind: 'initial', version: 2, subject: 'Senior Frontend Engineer, React and TypeScript', body, passed: true, isSelected: true, generatedBy: 'demo', feedback: '- [must fix] Avoid "i hope this email finds you well"', lintResult: { passed: true, errors: [], warnings: [], stats: { words: 152, sentences: 8, paragraphs: 5, avgSentenceLen: 19, sentenceLenStdDev: 7, subjectChars: 44 } }, judgeResult: { aiLikelihood: 22, tells: [], suggestions: ['Mention one concrete number from the HRMS project'] } },
    })
  }

  const sent = await db.application.upsert({
    where: { jobId: sentJob.id },
    update: { status: 'INTERVIEW', repliedAt: new Date(now - 2 * day) },
    create: { id: 'demo-app-sent', jobId: sentJob.id, channel: 'email', status: 'INTERVIEW', toEmail: 'jobs@demo-fintech.example', threadId: 'demo-thread-1', sentAt: new Date(now - 6 * day), repliedAt: new Date(now - 2 * day) },
  })
  await db.emailMessage.upsert({
    where: { provider_providerMessageId: { provider: 'demo', providerMessageId: 'demo-out-1' } },
    update: {},
    create: { applicationId: sent.id, direction: 'OUTBOUND', provider: 'demo', providerMessageId: 'demo-out-1', threadId: 'demo-thread-1', fromAddress: 'me@example.com', toAddress: 'jobs@demo-fintech.example', subject: 'Backend Engineer, TypeScript', bodyText: body.replace('Senior Frontend Engineer', 'Backend Engineer'), sentAt: new Date(now - 6 * day), isRead: true },
  })
  await db.emailMessage.upsert({
    where: { provider_providerMessageId: { provider: 'demo', providerMessageId: 'demo-in-1' } },
    update: {},
    create: {
      applicationId: sent.id,
      direction: 'INBOUND',
      provider: 'demo',
      providerMessageId: 'demo-in-1',
      threadId: 'demo-thread-1',
      fromAddress: 'Sarah Recruiter <sarah@demo-fintech.example>',
      toAddress: 'me@example.com',
      subject: 'Re: Backend Engineer, TypeScript',
      bodyText: 'Thanks Alex, this looks interesting. Could you do a 30 minute call on Thursday at 10:00 Dublin time?',
      receivedAt: new Date(now - 2 * day),
      classification: 'INTERVIEW_REQUEST',
      classificationMeta: { classification: 'INTERVIEW_REQUEST', confidence: 0.94, summary: 'Recruiter proposes a 30 minute call on Thursday at 10:00 Dublin time.', suggestedNextAction: 'Confirm the slot', proposedTimes: ['Thursday at 10:00 Dublin time'] },
      isRead: false,
    },
  })

  const runId = 'demo-run-1'
  await db.searchRun.upsert({
    where: { id: runId },
    update: {},
    create: {
      id: runId,
      trigger: 'MANUAL',
      status: 'COMPLETED',
      startedAt: new Date(now - 3 * 3600_000),
      finishedAt: new Date(now - 3 * 3600_000 + 95_000),
      durationMs: 95_000,
      totalFetched: 412,
      totalNew: 37,
      totalDuplicates: 375,
      totalFiltered: 12,
      totalEnriched: 25,
      totalRanked: 25,
      totalDrafted: 3,
      totalQueued: 0,
      errorCount: 0,
      sources: { create: [{ source: 'arbeitnow', requests: 5, returned: 300, created: 20, duplicates: 280, durationMs: 4200 }, { source: 'ats', requests: 40, returned: 112, created: 17, duplicates: 95, durationMs: 30_000 }] },
      logs: { create: [{ level: 'info', message: 'Run started (MANUAL)' }, { level: 'info', message: 'Discovery: 412 fetched, 37 new, 375 already known, 0 blacklisted' }, { level: 'info', message: 'Run COMPLETED in 95s' }] },
    },
  })

  await db.notification.upsert({ where: { id: 'demo-notif-1' }, update: {}, create: { id: 'demo-notif-1', type: 'interview', title: 'Interview request: Backend Engineer (TypeScript) at Demo Fintech Ltd', body: 'Recruiter proposes a 30 minute call on Thursday.', link: `/applications/${sent.id}` } })

  console.log('demo data ready:', { review: review.id, sent: sent.id, run: runId })
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
