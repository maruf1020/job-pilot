import type { Page } from 'playwright'

/**
 * Cloudflare Turnstile (Personio under the form, Workable after Submit) gives the page a token in a
 * hidden "cf-turnstile-response" box once it is satisfied. In a normal Chrome that usually happens by
 * itself within seconds; the agent only waits for it and never touches the widget.
 */

/** A Turnstile box on the page or in one of its frames that has no token yet. */
export async function turnstilePending(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const pending = await frame
      .evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="cf-turnstile-response"]')).some((i) => i.isConnected && !i.value))
      .catch(() => false)
    if (pending) return true
  }
  return false
}

/** Wait up to `ms` for every Turnstile box to get its token; true when none is left waiting. */
export async function waitForTurnstile(page: Page, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  for (;;) {
    if (!(await turnstilePending(page))) return true
    if (Date.now() >= deadline || page.isClosed()) return false
    await page.waitForTimeout(1500)
  }
}
