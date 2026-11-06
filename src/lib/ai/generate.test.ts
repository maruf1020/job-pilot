import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// The router reads keys from the DB and settings; both are faked here. No network: fetch is mocked.
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, usage: [] as Array<Record<string, unknown>>, updates: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/db', () => ({
  db: {
    aiKey: {
      findMany: vi.fn(async () => state.rows),
      update: vi.fn(async (args: Record<string, unknown>) => {
        state.updates.push(args)
        return {}
      }),
    },
    aiUsage: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.usage.push(args.data)
        return {}
      }),
      count: vi.fn(async () => 0),
    },
  },
}))

vi.mock('@/lib/settings/service', async () => {
  const { DEFAULT_AI } = await import('@/lib/settings/schema')
  return { getSettings: vi.fn(async () => ({ ai: DEFAULT_AI })) }
})

const { encryptSecret } = await import('@/lib/crypto')
const { generateJson, generateText, NoKeyAvailableError } = await import('./generate')
const { invalidateKeyCache } = await import('./key-pool')

function row(id: string, provider: string, baseUrl: string, priority: number, over: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    provider,
    baseUrl,
    encryptedKey: encryptSecret(`secret-${id}`),
    priority,
    plan: 'paid',
    dailyCallCap: null,
    primaryModel: null,
    liteModel: null,
    models: [],
    capabilities: null,
    rpmLimit: 10,
    rpdLimit: 250,
    usedToday: 0,
    usedTodayDate: null,
    ...over,
  }
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const ok = (content: string) => reply(200, { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7 } })

beforeEach(() => {
  state.rows = []
  state.usage = []
  state.updates = []
  invalidateKeyCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('router', () => {
  it('throws NoKeyAvailableError when no key is stored', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(generateText({ task: 'test', prompt: 'hi' })).rejects.toBeInstanceOf(NoKeyAvailableError)
  })

  it('moves to the next key when the first is rejected (auth) and logs the provider', async () => {
    state.rows = [row('k1', 'deepseek', 'https://a.invalid/v1', 1), row('k2', 'mistral', 'https://b.invalid/v1', 2)]
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('https://a.invalid') ? reply(401, { error: { message: 'invalid api key' } }) : ok('hello')))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateText({ task: 'test', prompt: 'hi' })
    expect(r.text).toBe('hello')
    expect(r.keyId).toBe('k2')
    expect(r.model).toBe('mistral-large-latest')
    expect(state.usage.map((u) => [u.keyId, u.provider, u.ok])).toEqual([
      ['k1', 'deepseek', false],
      ['k2', 'mistral', true],
    ])
    // The rejected key is marked failed and skipped for the rest of its quota day.
    expect(state.updates.some((u) => (u as { where: { id: string }; data: { status?: string } }).where.id === 'k1' && (u as { data: { status?: string } }).data.status === 'failed')).toBe(true)
    fetchMock.mockClear()
    await generateText({ task: 'test', prompt: 'again' })
    expect(fetchMock.mock.calls.every((c) => String(c[0]).startsWith('https://b.invalid'))).toBe(true)
  })

  it('moves on when the daily quota is gone (daily) and uses the lite model for lite tasks', async () => {
    state.rows = [row('k1', 'groq', 'https://a.invalid/v1', 1, { plan: 'free' }), row('k2', 'deepseek', 'https://b.invalid/v1', 1)]
    const fetchMock = vi.fn(async (url: string) => (url.startsWith('https://a.invalid') ? reply(429, { error: { message: 'Rate limit reached for model llama-3.1-8b-instant on requests per day (RPD)' } }) : ok('fine')))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateText({ task: 'rank', prompt: 'hi', model: 'lite' })
    expect(r.keyId).toBe('k2')
    const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { model: string }
    expect(first.model).toBe('llama-3.1-8b-instant')
  })

  it('fails fast on a bad request', async () => {
    state.rows = [row('k1', 'deepseek', 'https://a.invalid/v1', 1), row('k2', 'mistral', 'https://b.invalid/v1', 2)]
    const fetchMock = vi.fn(async () => reply(400, { error: { message: 'messages: content is required' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateText({ task: 'test', prompt: 'hi' })).rejects.toThrow(/content is required/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('generateJson puts the schema in the prompt for JSON-mode keys and validates the answer', async () => {
    state.rows = [row('k1', 'deepseek', 'https://a.invalid/v1', 1)]
    const fetchMock = vi.fn(async () => ok('```json\n{"fit": 80, "note": null}\n```'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateJson({ task: 'rank', prompt: 'Score it', schema: z.object({ fit: z.number(), note: z.string().optional() }) })
    expect(r.data).toEqual({ fit: 80 })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { response_format: unknown; messages: Array<{ content: string }> }
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages.at(-1)?.content).toContain('"fit"')
  })

  it('generateJson retries once with the validator errors', async () => {
    state.rows = [row('k1', 'deepseek', 'https://a.invalid/v1', 1)]
    const fetchMock = vi.fn().mockResolvedValueOnce(ok('{"fit": "high"}')).mockResolvedValueOnce(ok('{"fit": 70}'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateJson({ task: 'rank', prompt: 'Score it', schema: z.object({ fit: z.number() }) })
    expect(r.data).toEqual({ fit: 70 })
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as { messages: Array<{ content: string }> }
    expect(second.messages.at(-1)?.content).toContain('previous answer was not valid')
  })

  it('sends screenshots only to a vision key; a text-only key gets the text as a fallback', async () => {
    state.rows = [row('k1', 'deepseek', 'https://a.invalid/v1', 1), row('k2', 'openai', 'https://b.invalid/v1', 5)]
    const fetchMock = vi.fn(async () => ok('seen'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateText({ task: 'test', prompt: 'look', images: [{ mimeType: 'image/png', data: 'AAAA' }] })
    expect(r.keyId).toBe('k2')
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: Array<{ content: unknown }> }
    expect(Array.isArray(body.messages.at(-1)?.content)).toBe(true)
  })
})
