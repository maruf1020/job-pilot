import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

const { planImport, probeProvider, envAsText } = await import('./import')

const rep = (s: string, n: number) => s.repeat(Math.ceil(n / s.length)).slice(0, n)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planImport', () => {
  it('groups service fields, keeps AI keys with stable refs and warns about unusable entries', () => {
    const text = [
      `OPENAI_API_KEY=sk-proj-${rep('Ab3Cd4', 60)}`,
      `ADZUNA_APP_ID=abcd1234`,
      `ADZUNA_APP_KEY=${rep('0f', 32)}`,
      `TELEGRAM_BOT_TOKEN=123456789:${rep('AbCd_', 35)}`,
      `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-${rep('xY', 60)}`,
      `sk-${rep('0a1b2c', 32)}`,
      'DATABASE_URL=postgresql://u:p@localhost:5432/db',
    ].join('\n')
    const a = planImport(text)
    const b = planImport(text)
    expect(a.plans.map((p) => p.ref)).toEqual(b.plans.map((p) => p.ref))
    const kinds = a.plans.map((p) => (p.kind === 'ai' ? `ai:${p.provider ?? `?${p.candidates?.join('|')}`}` : `svc:${p.service}`))
    expect(kinds).toEqual(['ai:openai', 'ai:?deepseek|qwen', 'svc:adzuna', 'svc:telegram'])
    expect(a.warnings.some((w) => /subscription sign-in token/.test(w))).toBe(true)
    // Telegram without a chat id cannot be stored yet.
    expect(a.warnings.some((w) => /Telegram bot: TELEGRAM_CHAT_ID missing/.test(w))).toBe(true)
  })

  it('drops repeated keys', () => {
    const k = `gsk_${rep('Ab3Cd4', 52)}`
    expect(planImport(`${k}\nGROQ_API_KEY=${k}`).plans).toHaveLength(1)
    expect(planImport(`${k}\n${k}\n${k.replace('gsk_A', 'gsk_B')}`).plans).toHaveLength(2)
  })

  it('envAsText renders the environment as importable lines', () => {
    expect(envAsText({ A: 'x y', EMPTY: '', B: undefined })).toBe('A="x y"')
  })
})

describe('probeProvider', () => {
  it('picks the candidate whose model list accepts the key', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('https://api.deepseek.com')
        ? new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 })
        : new Response(JSON.stringify({ data: [{ id: 'qwen-plus' }, { id: 'qwen-turbo' }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await probeProvider(`sk-${rep('0a1b2c', 32)}`, ['deepseek', 'qwen'])
    expect(r).toEqual({ provider: 'qwen', models: ['qwen-plus', 'qwen-turbo'] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null when no candidate answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    expect(await probeProvider(rep('Ab3Cd4', 32), ['mistral'])).toEqual({ provider: null, models: [] })
  })
})
