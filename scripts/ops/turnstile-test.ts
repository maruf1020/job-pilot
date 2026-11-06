// Does Cloudflare's check pass? Opens a form page in a brand-new temporary profile (never your Chrome
// profile), waits, and reads the Turnstile widget. Nothing is filled or submitted.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function run(lib: 'playwright' | 'patchright', url: string) {
  const mod = (await import(lib)) as typeof import('playwright')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jf-cf-${lib}-`))
  const ctx = await mod.chromium.launchPersistentContext(dir, { channel: 'chrome', headless: false, viewport: null })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    let state = 'no widget'
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000)
      const token = await page.evaluate(() => (document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? null).catch(() => null)
      const hasFrame = page.frames().some((f) => /challenges\.cloudflare\.com/.test(f.url()))
      if (token) { state = `PASSED (token ${token.length} chars)`; break }
      if (hasFrame) state = 'widget present, no token yet'
    }
    const failed = await page.evaluate(() => /Verification failed/i.test(document.body.innerText)).catch(() => false)
    return `${lib}: ${failed ? 'FAILED (Verification failed shown)' : state}`
  } finally {
    await ctx.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const url = process.argv[2] ?? 'https://aixigo-ag.jobs.personio.com/job/2844613/apply'
  for (const lib of ['playwright', 'patchright'] as const) console.log(await run(lib, url).catch((e) => `${lib}: error ${e instanceof Error ? e.message.split('\n')[0] : e}`))
  process.exit(0)
}
main()
