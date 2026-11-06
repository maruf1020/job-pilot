import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// The e2e owner is created by scripts/seed-e2e.ts (a fictional person, already onboarded).
const username = process.env.E2E_USERNAME ?? 'Alex Rivera'
const password = process.env.E2E_PASSWORD ?? 'e2e-password-123'

setup('sign in and save the session', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true })

  await page.goto('/login')

  // Wrong password is rejected without leaking details.
  await page.getByLabel('Name').fill(username)
  await page.getByLabel('Password').fill('definitely-wrong-password')
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await expect(page.getByText(/Incorrect name or password/)).toBeVisible()
  // The typed name survives a failed attempt.
  await expect(page.getByLabel('Name')).toHaveValue(username)

  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/dashboard')
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()

  await page.context().storageState({ path: 'e2e/.auth/e2e-user.json' })
})
