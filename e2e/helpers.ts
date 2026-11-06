import { expect, type Page } from '@playwright/test'

export type Theme = 'light' | 'dark'

/** Start every page of this test in the given theme (next-themes keeps it in localStorage "theme"). */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('theme', t)
    } catch {
      /* storage blocked */
    }
  }, theme)
}

/** Console errors and uncaught page errors, minus known noise. Call before the first navigation. */
export function trackErrors(page: Page, ignore: RegExp[] = []): () => string[] {
  const errors: string[] = []
  const noise = [/favicon/i, /Download the React DevTools/i, ...ignore]
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (!noise.some((re) => re.test(text))) errors.push(text)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return () => errors
}

/**
 * Elements that stick out past the right edge of the viewport. The shell clips sideways overflow
 * on <main>, so the document's scroll width alone would hide a too-wide table; this looks at every
 * visible element instead, skipping content inside its own horizontal scroll area (wide tables in
 * an overflow-x container are fine) and off-canvas drawers.
 */
export async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const out: string[] = []
    const scrolls = (el: Element | null): boolean => {
      for (let p = el?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
      }
      return false
    }
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= vw + 1) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue
      if (el.closest('[aria-hidden="true"], [data-vaul-drawer], [role="dialog"], [data-radix-popper-content-wrapper]')) continue
      if (scrolls(el)) continue
      const id = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} right=${Math.round(r.right)} vw=${vw} text="${(el.textContent ?? '').trim().slice(0, 40)}"`
      out.push(id)
      if (out.length >= 5) break
    }
    // The page itself must not scroll sideways either.
    const doc = document.documentElement.scrollWidth - document.documentElement.clientWidth
    if (doc > 1) out.unshift(`document scrolls sideways by ${doc}px`)
    return out
  })
}

export async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const bad = await overflowingElements(page)
  expect(bad, `${label}: content wider than the screen`).toEqual([])
}

/** The page's main heading (every page has one h1 in its PageHeader). */
export function pageHeading(page: Page, name: string | RegExp) {
  return page.getByRole('heading', { level: 1, name })
}

/** Wait until skeletons and spinners are gone (client-side data has loaded). */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await expect(page.locator('[data-slot="skeleton"], [aria-busy="true"]').first()).toBeHidden({ timeout: 15_000 }).catch(() => undefined)
}
