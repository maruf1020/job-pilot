import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/pipeline/profile', () => ({ getProfileForPrompt: vi.fn() }))
vi.mock('./driver', () => ({ driveWithGemini: vi.fn() }))

const { asksNotToSubmit, asksToSubmit, listenForAsks, stopListening } = await import('./ask')

type Binding = (source: unknown, text: unknown) => Promise<string>

function fakePage() {
  let binding: Binding | null = null
  const page = {
    isClosed: () => false,
    exposeBinding: vi.fn(async (_name: string, fn: Binding) => {
      binding = fn
    }),
  }
  return { page: page as unknown as Page, raw: page, ask: (text: unknown) => binding!({}, text) }
}

describe('asksToSubmit', () => {
  it('sees a request to send the application', () => {
    expect(asksToSubmit('press Submit')).toBe(true)
    expect(asksToSubmit('fix the phone number and submit it')).toBe(true)
    expect(asksToSubmit('apply now')).toBe(true)
  })

  it('does not submit for a plain change', () => {
    expect(asksToSubmit('pick Portugal as country')).toBe(false)
    expect(asksToSubmit('answer the visa question No')).toBe(false)
  })

  it('hears "do not submit", typos included', () => {
    for (const t of ['dont click on submit button please', 'dony hit submit application please', 'do not send it yet', 'fill it without submitting']) {
      expect(asksNotToSubmit(t)).toBe(true)
      expect(asksToSubmit(t)).toBe(false)
    }
    expect(asksNotToSubmit('fill the salary before you submit')).toBe(false)
    expect(asksNotToSubmit('use cover letter in cover letter section not cv please')).toBe(false)
  })
})

describe('panel instructions', () => {
  it('go to whoever owns the tab now, trimmed', async () => {
    const { page, raw, ask } = fakePage()
    const attempt = vi.fn(async (t: string) => `attempt: ${t}`)
    const watcher = vi.fn(async (t: string) => `watcher: ${t}`)
    await listenForAsks(page, attempt)
    expect(await ask('  pick Portugal  ')).toBe('attempt: pick Portugal')
    // The watcher takes over the tab: the binding is not exposed twice.
    await listenForAsks(page, watcher)
    expect(raw.exposeBinding).toHaveBeenCalledTimes(1)
    expect(await ask('press Submit')).toBe('watcher: press Submit')
  })

  it('an old owner letting go does not drop the new one', async () => {
    const { page, ask } = fakePage()
    const attempt = vi.fn(async () => 'attempt')
    const watcher = vi.fn(async () => 'watcher')
    await listenForAsks(page, attempt)
    await listenForAsks(page, watcher)
    stopListening(page, attempt)
    expect(await ask('x')).toBe('watcher')
    stopListening(page, watcher)
    expect(await ask('x')).toMatch(/Nobody is working on this tab/)
  })

  it('reports a failure in the panel instead of throwing', async () => {
    const { page, ask } = fakePage()
    await listenForAsks(page, async () => {
      throw new Error('Gemini quota\nstack')
    })
    expect(await ask('x')).toBe('Could not do it: Gemini quota')
  })
})
