import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '@/lib/ai/providers'
import { ambiguousCandidates, detectProvider, parseKeyText, providerFromName, suggestModels } from './detect'
import { SERVICE_DEFS } from './service-keys-defs'

// Fake keys in each provider's format (never real ones).
const rep = (s: string, n: number) => s.repeat(Math.ceil(n / s.length)).slice(0, n)
const K = {
  gemini: `AIzaSy${rep('Ab3Cd4Ef5', 33)}`,
  geminiAq: `AQ.Ab8RN6${rep('xY7zW6', 40)}`,
  anthropic: `sk-ant-api03-${rep('aB3_cD4-eF5', 80)}`,
  anthropicOauth: `sk-ant-oat01-${rep('aB3cD4eF5', 80)}`,
  openaiProj: `sk-proj-${rep('Ab3Cd4Ef5_-', 120)}`,
  openaiSvc: `sk-svcacct-${rep('Ab3Cd4Ef5', 60)}`,
  openaiAdmin: `sk-admin-${rep('Ab3Cd4Ef5', 60)}`,
  openrouter: `sk-or-v1-${rep('0a1b2c3d4e5f', 64)}`,
  groq: `gsk_${rep('Ab3Cd4Ef5', 52)}`,
  xai: `xai-${rep('Ab3Cd4Ef5', 80)}`,
  perplexity: `pplx-${rep('Ab3Cd4Ef5', 48)}`,
  cerebras: `csk-${rep('ab3cd4ef5', 48)}`,
  fireworks: `fw_${rep('Ab3Cd4Ef5', 24)}`,
  together: `tgp_v1_${rep('Ab3Cd4Ef5', 43)}`,
  zhipu: `${rep('0a1b2c3d', 32)}.${rep('Ab3Cd4Ef', 16)}`,
  hex32: `sk-${rep('0a1b2c3d4e5f', 32)}`,
  alnum48: `sk-${rep('Ab3Cd4Ef5Gh6', 48)}`,
  plain32: rep('Ab3Cd4Ef5Gh6', 32),
  telegram: `123456789:${rep('AbCdEf_gh-IJ', 35)}`,
}

describe('parseKeyText', () => {
  it('reads NAME=value lines with export, quotes, comments and inline comments', () => {
    const text = [
      '# my keys',
      `export OPENAI_API_KEY="${K.openaiProj}"`,
      `ANTHROPIC_API_KEY='${K.anthropic}'`,
      `GROQ_API_KEY=${K.groq} # free tier`,
      '// another comment',
      '',
      'PORT=3000',
    ].join('\n')
    const out = parseKeyText(text)
    expect(out.map((e) => [e.name, e.value])).toEqual([
      ['OPENAI_API_KEY', K.openaiProj],
      ['ANTHROPIC_API_KEY', K.anthropic],
      ['GROQ_API_KEY', K.groq],
      ['PORT', '3000'],
    ])
    expect(out[0].line).toBe(2)
  })

  it('splits comma or space separated key lists', () => {
    const out = parseKeyText(`GEMINI_API_KEYS=${K.gemini},${K.geminiAq} ${K.gemini.replace('Sy', 'Sz')}`)
    expect(out).toHaveLength(3)
    expect(out.every((e) => e.name === 'GEMINI_API_KEYS')).toBe(true)
  })

  it('reads bare keys, one per line, and skips words that are not keys', () => {
    const out = parseKeyText(`${K.openrouter}\n\n  ${K.xai}  \nhello world\nshort`)
    expect(out.map((e) => [e.name, e.value])).toEqual([
      ['', K.openrouter],
      ['', K.xai],
    ])
  })

  it('reads flat and nested JSON', () => {
    expect(parseKeyText(JSON.stringify({ OPENAI_API_KEY: K.openaiProj, DEEPSEEK_API_KEY: K.hex32 })).map((e) => e.name)).toEqual(['OPENAI_API_KEY', 'DEEPSEEK_API_KEY'])
    const nested = parseKeyText(JSON.stringify({ openai: K.openaiProj, anthropic: { apiKey: K.anthropic }, gemini: [K.gemini, K.geminiAq] }))
    expect(nested.map((e) => [e.name, e.value])).toEqual([
      ['openai', K.openaiProj],
      ['anthropic.apiKey', K.anthropic],
      ['gemini', K.gemini],
      ['gemini', K.geminiAq],
    ])
  })

  it('returns nothing for empty text', () => {
    expect(parseKeyText('   \n ')).toEqual([])
  })
})

describe('detectProvider by key format', () => {
  const cases: Array<[string, string]> = [
    [K.gemini, 'gemini'],
    [K.geminiAq, 'gemini'],
    [K.anthropic, 'anthropic'],
    [K.openaiProj, 'openai'],
    [K.openaiSvc, 'openai'],
    [K.openaiAdmin, 'openai'],
    [K.openrouter, 'openrouter'],
    [K.groq, 'groq'],
    [K.xai, 'xai'],
    [K.perplexity, 'perplexity'],
    [K.cerebras, 'cerebras'],
    [K.fireworks, 'fireworks'],
    [K.together, 'together'],
    [K.zhipu, 'zhipu'],
  ]
  for (const [value, provider] of cases) {
    it(`${value.slice(0, 8)}... -> ${provider}`, () => {
      expect(detectProvider('', value)).toEqual({ kind: 'ai', provider, detectedBy: 'format' })
    })
  }

  it('reports a Claude subscription token as unsupported', () => {
    const d = detectProvider('CLAUDE_CODE_OAUTH_TOKEN', K.anthropicOauth)
    expect(d.kind).toBe('unsupported')
  })

  it('returns candidates for formats several providers share', () => {
    expect(detectProvider('', K.hex32)).toEqual({ kind: 'ai', candidates: ['deepseek', 'qwen'], detectedBy: 'unknown' })
    expect(detectProvider('', K.alnum48)).toEqual({ kind: 'ai', candidates: ['moonshot', 'openai'], detectedBy: 'unknown' })
    expect(detectProvider('', K.plain32)).toEqual({ kind: 'ai', candidates: ['mistral'], detectedBy: 'unknown' })
    expect(ambiguousCandidates(`sk-${rep('Ab3-Cd4_Ef5', 70)}`)).toEqual(['openai', 'deepseek', 'moonshot', 'qwen'])
  })

  it('leaves an unrecognised key without candidates', () => {
    expect(detectProvider('', rep('Zz9', 40))).toEqual({ kind: 'ai', candidates: [], detectedBy: 'unknown' })
  })
})

describe('detectProvider by variable name', () => {
  // A neutral value that no format claims, so only the name decides.
  const neutral = rep('q1w2e3r4t5', 40)
  for (const p of PROVIDERS) {
    for (const name of p.envNames) {
      it(`${name} -> ${p.id}`, () => {
        expect(detectProvider(name, neutral)).toEqual({ kind: 'ai', provider: p.id, detectedBy: 'name' })
      })
    }
  }

  it('handles numbered, prefixed and JSON-path names', () => {
    expect(providerFromName('GEMINI_API_KEY_3')).toBe('gemini')
    expect(providerFromName('NEXT_PUBLIC_OPENAI_API_KEY')).toBe('openai')
    expect(providerFromName('MY_KIMI_TOKEN')).toBe('moonshot')
    expect(providerFromName('openai')).toBe('openai')
    expect(detectProvider('anthropic.apiKey', neutral)).toEqual({ kind: 'ai', provider: 'anthropic', detectedBy: 'name' })
  })

  it('names decide ambiguous formats', () => {
    expect(detectProvider('DEEPSEEK_API_KEY', K.hex32)).toEqual({ kind: 'ai', provider: 'deepseek', detectedBy: 'name' })
    expect(detectProvider('DASHSCOPE_API_KEY', K.hex32)).toEqual({ kind: 'ai', provider: 'qwen', detectedBy: 'name' })
    expect(detectProvider('MOONSHOT_API_KEY', K.alnum48)).toEqual({ kind: 'ai', provider: 'moonshot', detectedBy: 'name' })
    expect(detectProvider('MISTRAL_API_KEY', K.plain32)).toEqual({ kind: 'ai', provider: 'mistral', detectedBy: 'name' })
  })

  it('a format that belongs to another provider wins over the name', () => {
    expect(detectProvider('OPENAI_API_KEY', K.openrouter)).toEqual({ kind: 'ai', provider: 'openrouter', detectedBy: 'format' })
  })

  it('ignores configuration and app secrets', () => {
    expect(detectProvider('OPENAI_BASE_URL', 'https://api.example.com/v1')).toEqual({ kind: 'ignore' })
    expect(detectProvider('GEMINI_MODEL', 'gemini-3.8-flash')).toEqual({ kind: 'ignore' })
    expect(detectProvider('AUTH_SECRET', K.plain32)).toEqual({ kind: 'ignore' })
    expect(detectProvider('APP_ENCRYPTION_KEY', K.plain32)).toEqual({ kind: 'ignore' })
    expect(detectProvider('DATABASE_URL', 'postgresql://u:p@localhost:5432/db')).toEqual({ kind: 'ignore' })
    expect(detectProvider('PORT', '3000')).toEqual({ kind: 'ignore' })
  })
})

describe('detectProvider for service credentials', () => {
  for (const def of SERVICE_DEFS) {
    for (const f of def.fields) {
      it(`${f.name} -> ${def.service}`, () => {
        expect(detectProvider(f.name, 'some-value-1234')).toEqual({ kind: 'service', service: def.service, field: f.name, detectedBy: 'name' })
      })
    }
  }

  it('recognises a bare Telegram bot token by format', () => {
    expect(detectProvider('', K.telegram)).toEqual({ kind: 'service', service: 'telegram', field: 'TELEGRAM_BOT_TOKEN', detectedBy: 'format' })
  })
})

describe('suggestModels', () => {
  it('uses the provider defaults when listed or when there is no list', () => {
    expect(suggestModels('openai', [])).toEqual({ primaryModel: 'gpt-5', liteModel: 'gpt-5-mini' })
    expect(suggestModels('openai', ['gpt-5', 'gpt-5-mini', 'text-embedding-3-small'])).toEqual({ primaryModel: 'gpt-5', liteModel: 'gpt-5-mini' })
  })
  it('picks from the list when the defaults are not there', () => {
    const s = suggestModels('groq', ['openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'whisper-large-v3'])
    expect(s.primaryModel).toBe('openai/gpt-oss-120b')
    expect(s.liteModel).toBe('llama-3.1-8b-instant')
  })
})
