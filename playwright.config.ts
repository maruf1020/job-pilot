import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile('.env')
} catch {
  /* env provided by the host */
}

// A dedicated port so the tests never reuse a `next dev` server someone left running.
const E2E_PORT = process.env.E2E_PORT ?? '3100'
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`
/** Its own session file: the e2e server signs in against the e2e database, not the real one. */
const STORAGE_STATE = 'e2e/.auth/e2e-user.json'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // The production build in .next-e2e against the <db>_e2e database (npm run test:e2e:prepare builds both);
    // the real database and the .next of a running `next dev` are never used.
    command: `node scripts/e2e-env.mjs npx next start -p ${E2E_PORT}`,
    url: `${baseURL}/api/health`,
    // Sign-in redirects go to AUTH_URL: point it at the e2e server, not the dev port in .env.
    env: { AUTH_URL: baseURL, APP_URL: baseURL },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testIgnore: /mobile\.spec\.ts|auth\.setup\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
      testMatch: /mobile\.spec\.ts/,
    },
  ],
})
