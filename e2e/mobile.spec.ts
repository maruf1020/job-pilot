import { expect, test } from '@playwright/test'
import { expectNoOverflow, pageHeading, trackErrors } from './helpers'

test.describe('Phone layout', () => {
  test('bottom bar reaches Today, Needs you, Mail and Jobs; More opens the rest', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/dashboard')
    await expect(pageHeading(page, 'Today')).toBeVisible()
    const bar = page.getByRole('navigation', { name: 'Main' })
    await expect(bar).toBeVisible()
    for (const [label, heading] of [
      ['Needs you', 'Needs you'],
      ['Mail', 'Mail'],
      ['Jobs', 'Jobs'],
      ['Today', 'Today'],
    ] as const) {
      await bar.getByRole('link', { name: new RegExp(`^${label}`) }).click()
      await expect(pageHeading(page, heading)).toBeVisible()
    }
    await bar.getByRole('button', { name: /^More/ }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('link', { name: /^Applications/ }).click()
    await expect(pageHeading(page, 'Applications')).toBeVisible()
    await bar.getByRole('button', { name: /^More/ }).click()
    await page.getByRole('dialog').getByRole('link', { name: /^Settings/ }).click()
    await expect(pageHeading(page, 'Settings')).toBeVisible()
    expect(errors()).toEqual([])
  })

  test('More sheet switches the theme', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^More/ }).click()
    const themes = page.getByRole('radiogroup', { name: 'Theme' })
    await themes.getByRole('radio', { name: /Dark/ }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await themes.getByRole('radio', { name: /Light/ }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
  })

  test('jobs render as cards without sideways scrolling', async ({ page }) => {
    await page.goto('/jobs?q=Demo%20Fintech')
    await expect(pageHeading(page, 'Jobs')).toBeVisible()
    await page.getByRole('tab', { name: /^All/ }).click()
    await expect(page.getByRole('link', { name: /Senior Frontend Engineer/ }).first()).toBeVisible()
    await expect(page.locator('table').first()).toBeHidden()
    await expectNoOverflow(page, 'jobs on a phone')
  })

  test('the account menu opens from the top bar', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(errors()).toEqual([])
  })

  test('application review and settings are usable on a phone', async ({ page }) => {
    await page.goto('/applications/demo-app-review')
    await expect(pageHeading(page, /Senior Frontend Engineer/)).toBeVisible()
    await expectNoOverflow(page, 'application on a phone')
    await page.goto('/settings/browser')
    await expect(pageHeading(page, 'Settings')).toBeVisible()
    await expectNoOverflow(page, 'settings on a phone')
  })
})
