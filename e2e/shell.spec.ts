import { expect, test } from '@playwright/test'
import { pageHeading, trackErrors } from './helpers'

test.describe('App shell (desktop)', () => {
  test('sidebar groups reach every section', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/dashboard')
    await expect(pageHeading(page, 'Today')).toBeVisible()
    const sidebar = page.locator('[data-sidebar="sidebar"]').first()
    for (const group of ['Act', 'Pipeline', 'System']) await expect(sidebar.getByText(group, { exact: true })).toBeVisible()
    for (const [label, heading] of [
      ['Needs you', 'Needs you'],
      ['Mail', 'Mail'],
      ['Jobs', 'Jobs'],
      ['Applications', 'Applications'],
      ['Companies', 'Companies'],
      ['Runs', 'Runs'],
      ['Hosts', 'Hosts'],
      ['Settings', 'Settings'],
      ['Today', 'Today'],
    ] as const) {
      await sidebar.getByRole('link', { name: new RegExp(`^${label}`) }).first().click()
      await expect(pageHeading(page, heading)).toBeVisible()
    }
    expect(errors()).toEqual([])
  })

  test('the active page is marked and the breadcrumb follows detail pages', async ({ page }) => {
    await page.goto('/jobs/demo-job-1')
    await expect(page.locator('[data-sidebar="sidebar"] a[aria-current="page"], [data-sidebar="sidebar"] [data-active="true"]').first()).toContainText('Jobs')
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs.getByRole('link', { name: 'Jobs' })).toBeVisible()
    await crumbs.getByRole('link', { name: 'Jobs' }).click()
    await expect(page).toHaveURL(/\/jobs$/)
  })

  test('Ctrl+K jumps to a page and searches jobs', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(pageHeading(page, 'Today')).toBeVisible()
    await page.keyboard.press('Control+k')
    const input = page.getByPlaceholder('Search pages, jobs, companies…')
    await expect(input).toBeVisible()
    await input.fill('hosts')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/hosts/)
    await expect(pageHeading(page, 'Hosts')).toBeVisible()
    // Live search finds a demo job by title.
    await page.keyboard.press('Control+k')
    await input.fill('Senior Frontend')
    await expect(page.getByRole('option', { name: /Senior Frontend Engineer/ }).first()).toBeVisible()
    await page.getByRole('option', { name: /Senior Frontend Engineer/ }).first().click()
    await expect(page).toHaveURL(/\/jobs\/demo-job-1/)
  })

  test('theme menu switches and the choice survives a reload', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: /Dark/ }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await page.reload()
    await expect(pageHeading(page, 'Today')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: /Light/ }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
  })

  test('notifications bell opens the list', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: /Notifications/ }).first().click()
    await expect(page.getByText(/Interview request/).first()).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('signed-out visitors are sent to the login page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const p = await ctx.newPage()
    await p.goto('/jobs')
    await expect(p).toHaveURL(/\/login\?next=%2Fjobs/)
    await expect(p.getByRole('heading', { name: 'Log in to Job Pilot' })).toBeVisible()
    await ctx.close()
  })

  test('sign out ends the session', async ({ browser }) => {
    // Its own context, so the shared session file stays signed in for the other tests.
    const ctx = await browser.newContext({ storageState: 'e2e/.auth/e2e-user.json' })
    const p = await ctx.newPage()
    await p.goto('/dashboard')
    await expect(pageHeading(p, 'Today')).toBeVisible()
    await p.locator('[data-sidebar="footer"]').getByRole('button').first().click()
    await p.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(p).toHaveURL(/\/login/)
    await p.goto('/dashboard')
    await expect(p).toHaveURL(/\/login/)
    await ctx.close()
  })
})
