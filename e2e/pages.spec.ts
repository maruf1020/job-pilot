import { expect, test } from '@playwright/test'
import { pageHeading, settled, trackErrors } from './helpers'

/**
 * Feature checks on the e2e database (demo rows from scripts/seed-demo.ts and scripts/seed-e2e.ts).
 * Nothing here can reach a real site, mailbox or worker: the e2e server uses its own database, its
 * own pg-boss queues (no worker reads them) and has no Gmail token.
 */

test.describe('Today', () => {
  test('shows what needs you, next steps, ongoing applications and the apply engine', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/dashboard')
    await expect(pageHeading(page, 'Today')).toBeVisible()
    await settled(page)
    await expect(page.getByRole('heading', { name: 'Next steps from companies' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Ongoing/ }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /Not hiring from abroad/ }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /This week/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Sync|Check Gmail/ }).first()).toBeVisible()
    // Submitted today / this week / this month / all time, and the chart, near the top.
    await expect(page.getByRole('heading', { name: 'Applications', exact: true })).toBeVisible()
    for (const tile of ['Submitted today', 'This month', 'All time']) await expect(page.getByText(tile, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Applications submitted' })).toBeVisible()
    // The demo interview request is a next step.
    await expect(page.getByText('Demo Fintech Ltd').first()).toBeVisible()
    expect(errors()).toEqual([])
  })
})

test.describe('Stats', () => {
  test('counts, the submissions chart in three views, the table view and every breakdown', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/stats')
    await expect(pageHeading(page, 'Stats')).toBeVisible()
    await settled(page)
    for (const tile of ['Submitted today', 'This week', 'This month', 'All time', 'Daily average', 'Best day', 'Streak']) await expect(page.getByText(tile, { exact: true }).first()).toBeVisible()
    const chart = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Applications submitted' }) })
    await chart.getByRole('button', { name: 'Per week' }).click()
    await expect(chart.getByText(/in the last 16 weeks/)).toBeVisible()
    await chart.getByRole('button', { name: 'Running total' }).click()
    await expect(chart.getByText(/in total; /)).toBeVisible()
    await page.getByRole('button', { name: '14 days' }).click()
    await expect(chart.getByText(/in the last 14 days/)).toBeVisible()
    await chart.getByText('Show as table').click()
    await expect(chart.getByRole('columnheader', { name: 'Browser agent' })).toBeVisible()
    for (const heading of ['Jobs found', 'Funnel, all time', 'Every day, last 6 months', 'Replies', 'Where jobs come from', 'Where applications went']) await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    expect(errors()).toEqual([])
  })
})

test.describe('Jobs', () => {
  test('quick views, search, sort, page size and filters are URL-synced', async ({ page }) => {
    await page.goto('/jobs')
    await expect(pageHeading(page, 'Jobs')).toBeVisible()
    for (const view of [/^Fit 60\+/, /^New this week/, /^Applied/, /^All/]) await expect(page.getByRole('tab', { name: view })).toBeVisible()
    await page.getByRole('tab', { name: /^All/ }).click()
    await page.getByRole('textbox', { name: 'Search' }).fill('Demo Fintech')
    await expect(page).toHaveURL(/q=Demo(\+|%20)Fintech/)
    await expect(page.getByRole('link', { name: 'Senior Frontend Engineer (React/TypeScript)' }).first()).toBeVisible()
    await page.getByRole('textbox', { name: 'Search' }).fill('Demo Health')
    await expect(page.getByRole('link', { name: 'Lead Software Engineer' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Senior Frontend Engineer (React/TypeScript)' })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Rows per page' }).click()
    await page.getByRole('option', { name: /50/ }).click()
    await expect(page).toHaveURL(/pageSize=50/)
    // Filtered-out jobs come back with a status filter in the URL.
    await page.goto('/jobs?filter[status]=FILTERED&q=Junior%20PHP')
    await expect(page.getByRole('link', { name: 'Junior PHP Developer' }).first()).toBeVisible()
  })

  test('job detail shows the score breakdown and the sponsorship evidence', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/jobs/demo-job-1')
    await expect(pageHeading(page, /Senior Frontend Engineer/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Score' })).toBeVisible()
    await expect(page.getByText('Sponsorship offered').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sponsorship' })).toBeVisible()
    await expect(page.getByText('We sponsor Critical Skills Employment Permits').first()).toBeVisible()
    expect(errors()).toEqual([])
  })
})

test.describe('Companies', () => {
  test('quick views, search and the company page with its history', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/companies')
    await expect(pageHeading(page, 'Companies')).toBeVisible()
    for (const view of [/^All/, /^Known sponsors/, /^With ATS board/, /^Blacklisted/]) await expect(page.getByRole('tab', { name: view })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search' }).fill('Demo Fintech')
    await expect(page).toHaveURL(/q=Demo(\+|%20)Fintech/)
    await expect(page.getByRole('row')).toHaveCount(2)
    await page.getByRole('link', { name: 'Demo Fintech Ltd' }).first().click()
    await expect(page).toHaveURL(/\/companies\/[a-z0-9]+$/)
    await expect(pageHeading(page, 'Demo Fintech Ltd')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
    await expect(page.getByText('Backend Engineer (TypeScript)').first()).toBeVisible()
    await expect(page.getByText('jobs@demo-fintech.example').first()).toBeVisible()
    expect(errors()).toEqual([])
  })
})

test.describe('Applications', () => {
  test('list views and the board', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/applications')
    await expect(pageHeading(page, 'Applications')).toBeVisible()
    await expect(page.getByText('Senior Frontend Engineer (React/TypeScript)').first()).toBeVisible()
    for (const view of ['ongoing', 'ready', 'followups', 'drafts']) {
      await page.goto(`/applications?view=${view}`)
      await expect(pageHeading(page, 'Applications')).toBeVisible()
      await settled(page)
    }
    await page.goto('/applications?view=ongoing')
    await expect(page.getByText('Backend Engineer (TypeScript)').first()).toBeVisible()
    await page.goto('/applications?view=board')
    await expect(page.getByRole('link', { name: 'Senior Frontend Engineer (React/TypeScript)' }).first()).toBeVisible()
    await page.getByRole('link', { name: 'Senior Frontend Engineer (React/TypeScript)' }).first().click()
    await expect(page).toHaveURL(/\/applications\/demo-app-review/)
    expect(errors()).toEqual([])
  })

  test('application detail: draft review and the reply thread', async ({ page }) => {
    await page.goto('/applications/demo-app-review')
    await expect(pageHeading(page, /Senior Frontend Engineer/)).toBeVisible()
    await expect(page.getByText('jobs@demo-fintech.example').first()).toBeVisible()
    await expect(page.getByLabel(/Subject/i).first()).toHaveValue(/Senior Frontend Engineer/)
    await page.goto('/applications/demo-app-sent')
    await expect(pageHeading(page, /Backend Engineer/)).toBeVisible()
    await expect(page.getByText(/Interview/).first()).toBeVisible()
    await expect(page.getByText('Could you do a 30 minute call').first()).toBeVisible()
  })

  test('auto-apply dialog keeps Start disabled until confirmed (never started in tests)', async ({ page }) => {
    await page.goto('/applications')
    const trigger = page.getByRole('button', { name: /^Email auto-apply/ }).first()
    await expect(trigger).toBeVisible()
    if (!(await trigger.isEnabled())) test.skip(true, 'an email batch is running')
    await trigger.click()
    await expect(page.getByRole('heading', { name: 'Auto-apply to your best matches' })).toBeVisible()
    const start = page.getByRole('button', { name: /^Start (continuous )?auto-apply/ })
    await expect(start).toBeVisible()
    await expect(start).toBeDisabled()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })
})

test.describe('Mail', () => {
  test('folders and the classic views: next steps, not hiring from abroad, all replies', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/mail')
    await expect(pageHeading(page, 'Mail')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Mail folders' })).toBeVisible()
    await page.goto('/inbox?tab=next-steps')
    await expect(page.getByText('Demo Fintech Ltd').first()).toBeVisible()
    await page.goto('/mail?tab=not-hiring-abroad')
    await expect(page.getByText('Demo Health BV').first()).toBeVisible()
    await page.getByRole('button', { name: /All replies/ }).click()
    await expect(page.getByText('Re: Backend Engineer, TypeScript').first()).toBeVisible()
    expect(errors()).toEqual([])
  })

  test('Sync queues a Gmail check and reports without a mailbox', async ({ page, request }) => {
    const res = await request.post('/api/inbox/sync')
    expect(res.status()).toBe(202)
    const status = (await (await request.get('/api/inbox/sync')).json()) as { data: { nextSteps: { count: number } } }
    expect(status.data.nextSteps.count).toBeGreaterThanOrEqual(1)
    await page.goto('/mail')
    await expect(page.getByRole('button', { name: 'Check Gmail for replies now' }).first()).toBeVisible()
  })
})

test.describe('Needs you and Hosts', () => {
  test('the queue lists the CAPTCHA form, the sign-in wall and the open question', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/queue')
    await expect(pageHeading(page, 'Needs you')).toBeVisible()
    await settled(page)
    await expect(page.getByRole('heading', { name: 'CAPTCHA forms' })).toBeVisible()
    await expect(page.getByText('Senior React Developer').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign-in and account walls' })).toBeVisible()
    await expect(page.getByText('demo-signin.example').first()).toBeVisible()
    await expect(page.getByText(/notice period in weeks/).first()).toBeVisible()
    // Filters narrow the list.
    await page.getByRole('tab', { name: /^Questions/ }).click()
    await expect(page.getByText(/notice period in weeks/).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'CAPTCHA forms' })).toBeHidden()
    expect(errors()).toEqual([])
  })

  test('hosts: skip a host for a week, then clear it', async ({ page, request }) => {
    await page.goto('/hosts')
    await expect(pageHeading(page, 'Hosts')).toBeVisible()
    await page.getByRole('textbox', { name: 'Search' }).fill('demo-signin')
    const actions = page.getByRole('button', { name: 'Actions for demo-signin.example' })
    await expect(actions).toBeVisible()
    await actions.click()
    await page.getByRole('menuitem', { name: 'Skip a week' }).click()
    await expect.poll(async () => ((await (await request.get('/api/hosts?q=demo-signin')).json()) as { data: Array<{ skipUntil: string | null }> }).data[0]?.skipUntil ?? null).not.toBeNull()
    await actions.click()
    await page.getByRole('menuitem', { name: 'Clear skip' }).click()
    await expect.poll(async () => ((await (await request.get('/api/hosts?q=demo-signin')).json()) as { data: Array<{ skipUntil: string | null }> }).data[0]?.skipUntil ?? null).toBeNull()
  })
})

test.describe('Runs', () => {
  test('list and run detail with sources and log', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/runs')
    await expect(pageHeading(page, 'Runs')).toBeVisible()
    await page.goto('/runs/demo-run-1')
    await expect(page.getByText('arbeitnow').first()).toBeVisible()
    await expect(page.getByText('Discovery: 412 fetched').first()).toBeVisible()
    await page.getByRole('tab', { name: /^Errors/ }).click()
    await expect(page.getByText('Discovery: 412 fetched')).toHaveCount(0)
    expect(errors()).toEqual([])
  })
})

test.describe('Settings', () => {
  test('every tab renders, and a change saves to the e2e database', async ({ page, request }) => {
    const errors = trackErrors(page)
    await page.goto('/settings')
    await expect(pageHeading(page, 'Settings')).toBeVisible()
    for (const tab of ['Search', 'Ranking', 'Email', 'AI', 'Browser', 'Scraping', 'Profile', 'General']) {
      await page.getByRole('link', { name: tab, exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp(tab === 'General' ? '/settings$' : `/settings/${tab.toLowerCase()}`))
      await settled(page)
    }
    // New fields from plan-apply-all.md are on their tabs.
    await page.goto('/settings/search')
    await expect(page.getByText(/Countries outside Europe/).first()).toBeVisible()
    await page.goto('/settings/browser')
    await expect(page.getByText(/per company/i).first()).toBeVisible()

    // Save: the digest hour on General, then put it back.
    await page.goto('/settings')
    const hour = page.getByLabel('Send at (hour, local time)')
    const before = await hour.inputValue()
    const next = before === '7' ? '8' : '7'
    await hour.fill(next)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Unsaved changes')).toBeHidden()
    const saved = (await (await request.get('/api/settings')).json()) as { data: { digestHourLocal: number } }
    expect(String(saved.data.digestHourLocal)).toBe(next)
    await hour.fill(before)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Unsaved changes')).toBeHidden()
    expect(errors()).toEqual([])
  })
})
