import { expect, test, type APIRequestContext } from '@playwright/test'

interface Envelope<T = unknown> {
  success: boolean
  statusCode: number
  message: string
  data: T
  meta?: { page: number; pageSize: number; total: number; totalPages: number; sortable: string[]; filterable: Array<{ field: string }> }
}

async function getJson<T = unknown>(request: APIRequestContext, url: string, expectedStatus = 200): Promise<Envelope<T>> {
  const res = await request.get(url)
  expect(res.status(), `${url} → ${res.status()}`).toBe(expectedStatus)
  return (await res.json()) as Envelope<T>
}

async function postJson<T = unknown>(request: APIRequestContext, url: string, data: unknown, expectedStatus = 200): Promise<Envelope<T>> {
  const res = await request.post(url, { data })
  expect(res.status(), `${url} → ${res.status()} ${await res.text()}`).toBe(expectedStatus)
  return (await res.json()) as Envelope<T>
}

test.describe('API contract', () => {
  test('health is public and reports the database', async ({ request }) => {
    const r = await getJson<{ status: string; db: string }>(request, '/api/health')
    expect(r.data.status).toBe('ok')
    expect(r.data.db).toBe('up')
  })

  test('unauthenticated API calls get a 401 envelope', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const res = await ctx.request.get('/api/jobs')
    expect(res.status()).toBe(401)
    const body = (await res.json()) as Envelope
    expect(body.success).toBe(false)
    await ctx.close()
  })

  test('status and dashboard aggregate the demo data', async ({ request }) => {
    const status = await getJson<{ quota: { keys: unknown[] }; workerAlive: boolean; nextRunAt: string | null }>(request, '/api/status')
    expect(Array.isArray(status.data.quota.keys)).toBe(true)
    const dash = await getJson<{ tiles: { foundTotal: number; sentTotal: number; replied: number }; funnel: Array<{ stage: string; count: number }>; needsReview: unknown[]; recentReplies: unknown[] }>(request, '/api/dashboard')
    expect(dash.data.tiles.foundTotal).toBeGreaterThanOrEqual(5)
    expect(dash.data.tiles.sentTotal).toBeGreaterThanOrEqual(1)
    expect(dash.data.tiles.replied).toBeGreaterThanOrEqual(1)
    expect(dash.data.funnel.length).toBe(6)
    expect(dash.data.needsReview.length).toBeGreaterThanOrEqual(1)
    expect(dash.data.recentReplies.length).toBeGreaterThanOrEqual(1)
  })

  test('stats: today, this week, this month and all time, with series and breakdowns', async ({ request }) => {
    const stats = await getJson<{
      timezone: string
      tiles: Array<{ key: string; now: { total: number; agent: number; manual: number; email: number }; before: { total: number } | null }>
      daily: Array<{ day: string; total: number }>
      weekly: unknown[]
      funnel: unknown[]
      replies: Array<{ key: string; count: number }>
    }>(request, '/api/dashboard/stats')
    expect(stats.data.tiles.map((t) => t.key)).toEqual(['today', 'week', 'month', 'all'])
    const all = stats.data.tiles.find((t) => t.key === 'all')!
    expect(all.now.total).toBeGreaterThanOrEqual(1)
    expect(all.now.total).toBe(all.now.agent + all.now.manual + all.now.email)
    expect(all.before).toBeNull()
    expect(stats.data.daily).toHaveLength(182)
    expect(stats.data.weekly).toHaveLength(16)
    expect(stats.data.funnel).toHaveLength(6)
    expect(stats.data.replies.some((r) => r.key === 'INTERVIEW_REQUEST')).toBe(true)
  })

  test('jobs list supports search, filters, sort, paging and rejects bad filters', async ({ request }) => {
    const all = await getJson<Array<{ id: string; title: string; status: string; score: { finalScore: number } | null }>>(request, '/api/jobs?pageSize=10&sort=-score')
    expect(all.meta?.total).toBeGreaterThanOrEqual(4)
    expect(all.meta?.sortable).toContain('score')
    // Hidden by default: FILTERED demo job
    expect(all.data.some((j) => j.status === 'FILTERED')).toBe(false)
    // Sorted by score desc: first has the highest score among returned
    const scores = all.data.map((j) => j.score?.finalScore ?? -1)
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])

    const search = await getJson<Array<{ companyName: string }>>(request, '/api/jobs?q=Demo%20Fintech')
    expect(search.data.length).toBeGreaterThanOrEqual(2)
    expect(search.data.every((j) => /demo fintech/i.test(j.companyName))).toBe(true)

    const filtered = await getJson<Array<{ status: string }>>(request, '/api/jobs?filter[status]=FILTERED')
    expect(filtered.data.length).toBeGreaterThanOrEqual(1)
    expect(filtered.data.every((j) => j.status === 'FILTERED')).toBe(true)

    const country = await getJson<Array<{ countryCode: string }>>(request, '/api/jobs?filter[country]=IE&filter[score][gte]=80')
    expect(country.data.every((j) => j.countryCode === 'IE')).toBe(true)

    const paged = await getJson(request, '/api/jobs?pageSize=2&page=2')
    expect(paged.meta?.page).toBe(2)
    expect(paged.meta?.pageSize).toBe(2)

    const bad = await request.get('/api/jobs?filter[nope]=1')
    expect(bad.status()).toBe(400)
    const badSort = await request.get('/api/jobs?sort=hacker')
    expect(badSort.status()).toBe(400)
  })

  test('job detail includes score breakdown, company and application', async ({ request }) => {
    const r = await getJson<{ title: string; score: { finalScore: number; breakdown: unknown[] }; company: { name: string }; application: { id: string } | null; sourceLinks: unknown[] }>(request, '/api/jobs/demo-job-1')
    expect(r.data.title).toContain('Senior Frontend Engineer')
    expect(r.data.score.finalScore).toBe(88)
    expect(r.data.score.breakdown.length).toBeGreaterThan(0)
    expect(r.data.company.name).toBe('Demo Fintech Ltd')
    expect(r.data.application?.id).toBe('demo-app-review')
    expect(r.data.sourceLinks.length).toBe(1)
    await getJson(request, '/api/jobs/does-not-exist', 404)
  })

  test('job actions: skip and unskip round-trip', async ({ request }) => {
    const skip = await postJson<{ status: string }>(request, '/api/jobs/demo-job-3/actions', { action: 'skip' })
    expect(skip.data.status).toBe('SKIPPED')
    const un = await postJson<{ status: string }>(request, '/api/jobs/demo-job-3/actions', { action: 'unskip' })
    expect(un.data.status).toBe('RANKED')
  })

  test('applications: list, detail, lint, save a human version, select it', async ({ request }) => {
    const list = await getJson<Array<{ id: string; status: string; job: { title: string } }>>(request, '/api/applications?sort=-lastActivityAt')
    expect(list.data.some((a) => a.id === 'demo-app-review')).toBe(true)
    const byStatus = await getJson<Array<{ status: string }>>(request, '/api/applications?filter[status][in]=INTERVIEW,OFFER')
    expect(byStatus.data.length).toBeGreaterThanOrEqual(1)
    expect(byStatus.data.every((a) => ['INTERVIEW', 'OFFER'].includes(a.status))).toBe(true)

    const detail = await getJson<{ drafts: Array<{ id: string; version: number; passed: boolean; isSelected: boolean }>; messages: unknown[]; job: { companyName: string } }>(request, '/api/applications/demo-app-review')
    expect(detail.data.drafts.length).toBeGreaterThanOrEqual(2)
    expect(detail.data.drafts.find((d) => d.isSelected)?.passed).toBe(true)

    const lint = await postJson<{ passed: boolean; errors: Array<{ rule: string }> }>(request, '/api/applications/demo-app-review/actions', {
      action: 'lint',
      subject: 'Application for Senior Frontend Engineer',
      body: 'I hope this email finds you well! I am writing to express my interest. I am a passionate self-starter.',
    })
    expect(lint.data.passed).toBe(false)
    expect(lint.data.errors.map((e) => e.rule)).toContain('banned-phrase')
    expect(lint.data.errors.map((e) => e.rule)).toContain('length')

    const before = detail.data.drafts.length
    const saved = await postJson<{ draft: { id: string; version: number; generatedBy: string }; lint: { passed: boolean } }>(request, '/api/applications/demo-app-review/actions', {
      action: 'save-draft',
      subject: 'Senior Frontend Engineer at Demo Fintech Ltd',
      body: `Hi Demo Fintech Ltd team,\n\nYour Senior Frontend Engineer posting mentions React and TypeScript on the merchant dashboard, close to what I spent the last two years on. At Northwind Labs I lead a team of 10 engineers and built an HRMS in React and PostgreSQL that the whole company uses daily.\n\nThe migration work interests me most. We moved a Redux app in stages last year, and the hard parts were shared auth and feature flags, which I would enjoy comparing notes on.\n\nI'm based in Lisbon, can work anywhere in the EU without a visa, and can start within about eight weeks. Would a short call next week suit you?\n\nAlex Rivera`,
    })
    expect(saved.data.draft.generatedBy).toBe('human')
    expect(saved.data.lint.passed).toBe(true)
    const after = await getJson<{ drafts: Array<{ id: string; isSelected: boolean }> }>(request, '/api/applications/demo-app-review')
    expect(after.data.drafts.length).toBe(before + 1)
    expect(after.data.drafts.find((d) => d.isSelected)?.id).toBe(saved.data.draft.id)

    const first = after.data.drafts[after.data.drafts.length - 1]
    const sel = await postJson<{ selected: string }>(request, '/api/applications/demo-app-review/actions', { action: 'select-draft', draftId: first.id })
    expect(sel.data.selected).toBe(first.id)
    // put the passing human version back as selected
    await postJson(request, '/api/applications/demo-app-review/actions', { action: 'select-draft', draftId: saved.data.draft.id })
  })

  test('approve without a mail provider is refused with a reason', async ({ request }) => {
    const res = await request.post('/api/applications/demo-app-review/actions', { data: { action: 'approve' } })
    const body = (await res.json()) as Envelope
    // Either queued (provider configured) or a clear 400 explaining why not.
    if (res.status() === 200) expect(body.success).toBe(true)
    else {
      // 400: no mail provider or an unusable address; 409: the company was applied to within the cooldown.
      expect([400, 409]).toContain(res.status())
      expect(body.message.length).toBeGreaterThan(5)
    }
  })

  test('bulk approve-all-passing (dry run) reports what it would queue without queueing anything', async ({ request }) => {
    // dryRun stays mandatory: even on the e2e database the suite never queues an application.
    const r = await postJson<{ queued: number; considered: number; reasons: Record<string, number>; dryRun: boolean }>(request, '/api/applications/bulk', { action: 'approve-all-passing', dryRun: true })
    expect(r.data.dryRun).toBe(true)
    expect(r.data.considered).toBeGreaterThanOrEqual(0)
    expect(r.data.queued + Object.values(r.data.reasons).reduce((a, b) => a + b, 0)).toBe(r.data.considered)
    const queued = await getJson<Array<{ id: string }>>(request, '/api/applications?filter[status][in]=QUEUED,APPROVED&pageSize=5')
    // Whatever was queued before the test stays as it was; the dry run adds nothing (checked via the demo row below).
    expect(Array.isArray(queued.data)).toBe(true)
    const demo = await getJson<{ status: string }>(request, '/api/applications/demo-app-review')
    expect(['REVIEW', 'NEEDS_HUMAN', 'SENT', 'REPLIED']).toContain(demo.data.status)
  })

  test('the automatic sender is paused by default and demo domains are refused', async ({ request }) => {
    const status = await getJson<{ sendingEnabled: boolean }>(request, '/api/status')
    expect(status.data.sendingEnabled).toBe(false)
    // The demo application must never be queued: its address is on a reserved domain (or it is
    // already sent / on cooldown). Whatever the reason, the answer is a refusal, not a queue.
    const res = await request.post('/api/applications/demo-app-review/actions', { data: { action: 'approve' } })
    expect([400, 409]).toContain(res.status())
    expect(((await res.json()) as Envelope).message.length).toBeGreaterThan(5)
    const after = await getJson<{ status: string }>(request, '/api/applications/demo-app-review')
    expect(['QUEUED', 'APPROVED']).not.toContain(after.data.status)
  })

  test('runs: list, detail and manual trigger', async ({ request }) => {
    // Real runs accumulate ahead of the seeded one, so look at a larger page.
    const list = await getJson<Array<{ id: string; status: string }>>(request, '/api/runs?sort=-startedAt&pageSize=100')
    expect(list.data.some((r) => r.id === 'demo-run-1')).toBe(true)
    const detail = await getJson<{ sources: unknown[]; logs: unknown[]; totalNew: number }>(request, '/api/runs/demo-run-1')
    expect(detail.data.sources.length).toBe(2)
    expect(detail.data.logs.length).toBe(3)
    expect(detail.data.totalNew).toBe(37)
    const trigger = await request.post('/api/runs', { data: { skipDrafts: true } })
    expect(trigger.status()).toBe(202)
  })

  test('companies: list, create, update, detail', async ({ request }) => {
    const list = await getJson<Array<{ id: string; name: string; _count: { jobs: number } }>>(request, '/api/companies?q=Demo%20Fintech')
    expect(list.data.length).toBeGreaterThanOrEqual(1)
    expect(list.data[0]._count.jobs).toBeGreaterThanOrEqual(2)
    const created = await postJson<{ id: string; name: string }>(request, '/api/companies', { name: 'E2E Test Company', countryCode: 'IE', knownSponsor: true, atsType: 'greenhouse', atsSlug: 'e2etest' }, 201)
    expect(created.data.name).toBe('E2E Test Company')
    const patched = await request.patch(`/api/companies/${created.data.id}`, { data: { blacklisted: true, notes: 'e2e' } })
    expect(patched.status()).toBe(200)
    const detail = await getJson<{ blacklisted: boolean; jobs: unknown[] }>(request, `/api/companies/${created.data.id}`)
    expect(detail.data.blacklisted).toBe(true)
    const filtered = await getJson<Array<{ blacklisted: boolean }>>(request, '/api/companies?filter[blacklisted]=true')
    expect(filtered.data.every((c) => c.blacklisted)).toBe(true)
    const withAts = await getJson<Array<{ atsType: string | null }>>(request, '/api/companies?filter[hasAts]=true&pageSize=100')
    expect(withAts.data.every((c) => c.atsType)).toBe(true)
  })

  test('inbox lists the demo reply and marks it read', async ({ request }) => {
    const list = await getJson<Array<{ id: string; classification: string; isRead: boolean; application: { id: string } }>>(request, '/api/inbox')
    const reply = list.data.find((m) => m.classification === 'INTERVIEW_REQUEST')
    expect(reply).toBeTruthy()
    const detail = await getJson<{ isRead: boolean; application: { id: string } }>(request, `/api/inbox/${reply!.id}`)
    expect(detail.data.application.id).toBe(reply!.application.id)
    const again = await getJson<Array<{ id: string; isRead: boolean }>>(request, '/api/inbox?filter[isRead]=true')
    expect(again.data.some((m) => m.id === reply!.id)).toBe(true)
    const poll = await request.post('/api/inbox')
    expect(poll.status()).toBe(202)
  })

  test('notifications list and mark-all-read', async ({ request }) => {
    const r = await getJson<{ items: unknown[]; unread: number }>(request, '/api/notifications')
    expect(Array.isArray(r.data.items)).toBe(true)
    const mark = await postJson<{ updated: number }>(request, '/api/notifications', { all: true })
    expect(mark.data.updated).toBeGreaterThanOrEqual(0)
    const after = await getJson<{ unread: number }>(request, '/api/notifications')
    expect(after.data.unread).toBe(0)
  })

  test('settings round-trip and validation', async ({ request }) => {
    const s = await getJson<{ ranking: { draftThreshold: number }; search: { queries: string[]; sources: Record<string, { enabled: boolean }> }; ai: { fallbackModels: Record<string, string[]> } }>(request, '/api/settings')
    const original = s.data.ranking.draftThreshold
    expect(s.data.search.queries.length).toBeGreaterThan(0)
    expect(s.data.search.sources.scrape).toBeTruthy()
    expect(Object.keys(s.data.ai.fallbackModels).length).toBeGreaterThan(0)
    const patched = await request.patch('/api/settings', { data: { ranking: { draftThreshold: 65 } } })
    expect(patched.status()).toBe(200)
    const after = await getJson<{ ranking: { draftThreshold: number } }>(request, '/api/settings')
    expect(after.data.ranking.draftThreshold).toBe(65)
    await request.patch('/api/settings', { data: { ranking: { draftThreshold: original } } })
    const invalid = await request.patch('/api/settings', { data: { ranking: { draftThreshold: 500 } } })
    expect(invalid.status()).toBe(422)
  })

  test('AI keys, usage, banned phrases, profile, scrape targets, email status', async ({ request }) => {
    const keys = await getJson<Array<{ label: string; keyHint: string; enabled: boolean }>>(request, '/api/settings/ai-keys')
    expect(keys.data.length).toBeGreaterThanOrEqual(1)
    // Only the last characters of a key ever leave the server.
    expect(keys.data[0].keyHint).toMatch(/^[\w-]{1,8}$/)
    const usage = await getJson<{ keys: unknown[]; remainingDaily: number }>(request, '/api/settings/ai-test')
    expect(usage.data.remainingDaily).toBeGreaterThanOrEqual(0)
    const phrases = await getJson<Array<{ phrase: string }>>(request, '/api/settings/banned-phrases')
    expect(phrases.data.length).toBeGreaterThan(50)
    const added = await postJson<{ id: string }>(request, '/api/settings/banned-phrases', { phrase: 'e2e-only-phrase', severity: 'warn', category: 'buzzword' }, 201)
    const del = await request.delete(`/api/settings/banned-phrases/${added.data.id}`)
    expect(del.status()).toBe(200)
    const profile = await getJson<{ profile: { fullName: string; facts: string[] }; resume: { fileName: string } | null }>(request, '/api/profile')
    expect(profile.data.profile.fullName).toContain('Alex')
    expect(profile.data.profile.facts.length).toBeGreaterThan(3)
    const targets = await getJson<Array<{ name: string; enabled: boolean }>>(request, '/api/scrape-targets')
    expect(targets.data.length).toBeGreaterThanOrEqual(2)
    expect(targets.data.every((t) => !t.enabled || t.name)).toBe(true)
    const created = await postJson<{ id: string }>(request, '/api/scrape-targets', { name: 'E2E target', url: 'https://example.com/jobs?page={page}', enabled: false, maxPages: 1, maxLinks: 5 }, 201)
    const badRegex = await request.post('/api/scrape-targets', { data: { name: 'bad', url: 'https://example.com', linkPattern: '[' } })
    expect(badRegex.status()).toBe(422)
    const removed = await request.delete(`/api/scrape-targets/${created.data.id}`)
    expect(removed.status()).toBe(200)
    const email = await getJson<{ provider: string; ready: { ready: boolean }; gmail: { redirectUri: string } }>(request, '/api/email')
    expect(email.data.gmail.redirectUri).toContain('/api/gmail/callback')
  })

  test('contact discovery batch endpoint reports scopes, validates input and cancels safely', async ({ request }) => {
    const status = await getJson<{ latest: { status: string } | null; counts: Record<string, number> }>(request, '/api/contacts/batch?counts=true')
    expect(status.data.counts).toBeTruthy()
    for (const scope of ['above_threshold', 'all_ranked', 'all_companies']) expect(typeof status.data.counts[scope]).toBe('number')
    expect(status.data.counts.all_companies).toBeGreaterThanOrEqual(status.data.counts.all_ranked)
    const bad = await request.post('/api/contacts/batch', { data: { scope: 'everything' } })
    expect(bad.status()).toBe(422)
    const tooBig = await request.post('/api/contacts/batch', { data: { scope: 'all_ranked', batchSize: 500 } })
    expect(tooBig.status()).toBe(422)
    // Cancelling when nothing runs is a no-op, never an error.
    if (status.data.latest?.status !== 'RUNNING') {
      const cancel = await request.delete('/api/contacts/batch')
      expect(cancel.status()).toBe(200)
      expect(((await cancel.json()) as Envelope<{ cancelled: number }>).data.cancelled).toBe(0)
    }
    // Company contact fields are exposed on the detail endpoint.
    const companies = await getJson<Array<{ id: string; contactEmail: string | null; contactEmailSource: string | null; contactCandidates: string[] }>>(request, '/api/companies?q=Demo%20Fintech')
    const fintech = companies.data.find((c) => c.contactEmail === 'jobs@demo-fintech.example')
    expect(fintech).toBeTruthy()
    expect(Array.isArray(fintech!.contactCandidates)).toBe(true)
    // A manual edit of the company address records the source.
    const patched = await request.patch(`/api/companies/${fintech!.id}`, { data: { contactEmail: 'talent@demo-fintech.example' } })
    expect(patched.status()).toBe(200)
    expect(((await patched.json()) as Envelope<{ contactEmailSource: string }>).data.contactEmailSource).toBe('manual')
    const restored = await request.patch(`/api/companies/${fintech!.id}`, { data: { contactEmail: 'jobs@demo-fintech.example' } })
    expect(restored.status()).toBe(200)
    const missing = await request.post('/api/companies/does-not-exist/find-contact')
    expect(missing.status()).toBe(404)
  })

  test('sponsor registers summary and board discovery input validation', async ({ request }) => {
    const summary = await getJson<Array<{ country: string; rows: number }>>(request, '/api/companies/sponsor-registers')
    expect(summary.data.map((r) => r.country).sort()).toEqual(['GB', 'IE', 'NL'])
    const bad = await request.post('/api/companies/sponsor-registers', { data: { countries: ['XX'] } })
    expect(bad.status()).toBe(422)
    const badScope = await request.post('/api/companies/discover-boards', { data: { scope: 'everything' } })
    expect(badScope.status()).toBe(422)
    const status = await getJson<{ googleSearch: { used: number; limit: number } }>(request, '/api/status')
    expect(status.data.googleSearch.limit).toBe(100)
    expect(status.data.googleSearch.used).toBeLessThanOrEqual(100)
  })

  test('auto-apply: preview is read-only and starting requires explicit confirmation (never started here)', async ({ request }) => {
    const preview = await getJson<{ eligible: number; readyNow: number; needDraft: number; dailySendCap: number; cooldownDays: number }>(request, '/api/apply-batches/preview?minScore=80')
    expect(preview.data.eligible).toBe(preview.data.readyNow + preview.data.needDraft)
    expect(preview.data.cooldownDays).toBeGreaterThanOrEqual(0)
    // Without confirmSend, or out of range, the request is rejected before anything happens.
    expect((await request.post('/api/apply-batches', { data: { target: 5, minScore: 90 } })).status()).toBe(422)
    expect((await request.post('/api/apply-batches', { data: { target: 1, minScore: 90, confirmSend: true } })).status()).toBe(422)
    expect((await request.post('/api/apply-batches', { data: { target: 1001, minScore: 90, confirmSend: true } })).status()).toBe(422)
    // Stopping when nothing runs is a harmless no-op.
    const latest = await getJson<{ status: string } | null>(request, '/api/apply-batches')
    if (latest.data?.status !== 'RUNNING') {
      const stop = await request.delete('/api/apply-batches')
      expect(stop.status()).toBe(200)
    }
  })

  test('stop run refuses runs that are not running and unknown runs', async ({ request }) => {
    const finished = await request.post('/api/runs/demo-run-1/cancel')
    expect(finished.status()).toBe(400)
    expect(((await finished.json()) as Envelope).message).toMatch(/not running/i)
    const unknown = await request.post('/api/runs/does-not-exist/cancel')
    expect(unknown.status()).toBe(404)
    const detail = await getJson<{ cancelRequested: boolean; status: string }>(request, '/api/runs/demo-run-1')
    expect(detail.data.cancelRequested).toBe(false)
  })
  test('new endpoints: sync, ongoing, not hiring from abroad, queue, hosts, company history', async ({ request }) => {
    const sync = await request.post('/api/inbox/sync')
    expect(sync.status()).toBe(202)
    const status = await getJson<{ running: boolean; nextSteps: { count: number; items: Array<{ company?: string }> } }>(request, '/api/inbox/sync')
    expect(status.data.nextSteps.count).toBeGreaterThanOrEqual(1)

    const ongoing = await getJson<Array<{ applicationId?: string; id?: string }>>(request, '/api/applications/ongoing')
    expect(Array.isArray(ongoing.data)).toBe(true)
    expect(JSON.stringify(ongoing.data)).toContain('demo-app-sent')

    const abroad = await getJson<unknown>(request, '/api/insights/not-hiring-abroad')
    expect(JSON.stringify(abroad.data)).toContain('Demo Health BV')
    expect(JSON.stringify(abroad.data)).toContain('Demo Toronto Inc')

    const queue = await getJson<unknown>(request, '/api/queue')
    const q = JSON.stringify(queue.data)
    expect(q).toContain('demo-app-captcha')
    expect(q).toContain('demo-signin.example')

    const hosts = await getJson<Array<{ host: string; kind: string }>>(request, '/api/hosts?q=demo')
    expect(hosts.data.map((h) => h.host)).toEqual(expect.arrayContaining(['demo-captcha.example', 'demo-signin.example']))
    const bad = await request.get('/api/hosts?filter[nope]=1')
    expect(bad.status()).toBe(400)

    const companies = await getJson<Array<{ id: string; name: string }>>(request, '/api/companies?q=Demo%20Fintech')
    const fintech = companies.data.find((c) => c.name === 'Demo Fintech Ltd')!
    const history = await getJson<unknown>(request, `/api/companies/${fintech.id}/history`)
    expect(JSON.stringify(history.data)).toContain('Backend Engineer (TypeScript)')
  })
})
