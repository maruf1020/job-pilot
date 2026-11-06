import { expect, test } from '@playwright/test'
import { expectNoOverflow, pageHeading, settled, trackErrors, useTheme, type Theme } from './helpers'

/** Every route of the app with the h1 it must show. Detail pages use the demo rows (scripts/seed-demo.ts, seed-e2e.ts). */
const ROUTES: Array<{ path: string; heading: string | RegExp }> = [
  { path: '/dashboard', heading: 'Today' },
  { path: '/queue', heading: 'Needs you' },
  { path: '/mail', heading: 'Mail' },
  { path: '/jobs', heading: 'Jobs' },
  { path: '/jobs/demo-job-1', heading: /Senior Frontend Engineer/ },
  { path: '/applications', heading: 'Applications' },
  { path: '/applications?view=board', heading: 'Applications' },
  { path: '/applications?view=ongoing', heading: 'Applications' },
  { path: '/applications?view=ready', heading: 'Applications' },
  { path: '/applications?view=followups', heading: 'Applications' },
  { path: '/applications?view=drafts', heading: 'Applications' },
  { path: '/mail?tab=next-steps', heading: 'Mail' },
  { path: '/mail?tab=not-hiring-abroad', heading: 'Mail' },
  { path: '/applications/demo-app-captcha', heading: /Senior React Developer/ },
  { path: '/applications/demo-app-review', heading: /Senior Frontend Engineer/ },
  { path: '/applications/demo-app-sent', heading: /Backend Engineer/ },
  { path: '/companies', heading: 'Companies' },
  { path: '/runs', heading: 'Runs' },
  { path: '/runs/demo-run-1', heading: /Run|Manual/i },
  { path: '/hosts', heading: 'Hosts' },
  { path: '/settings', heading: 'Settings' },
  { path: '/settings/search', heading: 'Settings' },
  { path: '/settings/ranking', heading: 'Settings' },
  { path: '/settings/email', heading: 'Settings' },
  { path: '/settings/ai', heading: 'Settings' },
  { path: '/settings/browser', heading: 'Settings' },
  { path: '/settings/scraping', heading: 'Settings' },
  { path: '/settings/profile', heading: 'Settings' },
]

const VIEWS: Array<{ width: number; height: number; theme: Theme }> = [
  { width: 360, height: 780, theme: 'light' },
  { width: 360, height: 780, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
  { width: 1440, height: 900, theme: 'dark' },
]

test.describe('Every route renders cleanly', () => {
  let companyPath = ''
  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/companies?q=Demo%20Fintech')
    const body = (await res.json()) as { data: Array<{ id: string; name: string }> }
    const row = body.data.find((c) => c.name === 'Demo Fintech Ltd')
    if (row) companyPath = `/companies/${row.id}`
  })

  for (const view of VIEWS) {
    test(`all routes at ${view.width}px, ${view.theme}`, async ({ page }) => {
      test.setTimeout(240_000)
      await page.setViewportSize({ width: view.width, height: view.height })
      await useTheme(page, view.theme)
      const errors = trackErrors(page)
      const routes = companyPath ? [...ROUTES, { path: companyPath, heading: 'Demo Fintech Ltd' }] : ROUTES
      for (const r of routes) {
        await page.goto(r.path)
        await expect(pageHeading(page, r.heading).first(), `${r.path} heading`).toBeVisible()
        await settled(page)
        const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
        expect(dark, `${r.path} theme`).toBe(view.theme === 'dark')
        await expectNoOverflow(page, `${r.path} at ${view.width}px ${view.theme}`)
      }
      // Console errors include React hydration mismatches (a server/client text difference in the shell).
      expect(errors(), 'console errors').toEqual([])
    })
  }

  test('unknown routes show the not-found page', async ({ page }) => {
    await page.goto('/this-does-not-exist')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    // The way back is a link rendered through the Button component (exposed as a button).
    await page.getByRole('button', { name: 'Go to Today' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(pageHeading(page, 'Today')).toBeVisible()
  })
})
