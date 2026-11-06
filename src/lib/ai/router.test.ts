import { describe, expect, it } from 'vitest'
import type { PooledKey } from './key-pool'
import { modelChain, planCandidates, requestFor } from './router'

function key(id: string, provider: string, over: Partial<PooledKey> = {}): PooledKey {
  const defaults: Record<string, [string, string]> = {
    gemini: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    anthropic: ['claude-opus-5-5', 'claude-haiku-5-5'],
    openai: ['gpt-5', 'gpt-5-mini'],
    deepseek: ['deepseek-chat', 'deepseek-chat'],
  }
  const [primaryModel, liteModel] = defaults[provider] ?? ['m-primary', 'm-lite']
  const caps: Record<string, PooledKey['capabilities']> = {
    gemini: { jsonSchema: 'native', vision: true, webSearch: true },
    anthropic: { jsonSchema: 'native', vision: true, webSearch: true },
    openai: { jsonSchema: 'native', vision: true, webSearch: false },
    deepseek: { jsonSchema: 'json_object', vision: false, webSearch: false },
  }
  return {
    id,
    label: id,
    provider,
    apiKey: 'test',
    baseUrl: 'https://example.invalid',
    priority: 100,
    plan: 'free',
    dailyCallCap: null,
    primaryModel,
    liteModel,
    models: [],
    capabilities: caps[provider] ?? { jsonSchema: 'prompt', vision: false, webSearch: false },
    rpmLimit: 10,
    rpdLimit: 250,
    usedToday: 0,
    ...over,
  }
}

const pairs = (c: Array<{ key: PooledKey; model: string }>) => c.map((x) => `${x.key.id}:${x.model}`)

describe('requestFor', () => {
  it('maps tiers and explicit model ids', () => {
    expect(requestFor({})).toEqual({ tier: 'primary', images: false, webSearch: false })
    expect(requestFor({ model: 'lite', webSearch: true })).toEqual({ tier: 'lite', images: false, webSearch: true })
    expect(requestFor({ model: 'gemini-3.8-flash', images: [{}] })).toEqual({ tier: 'primary', explicitModel: 'gemini-3.8-flash', images: true, webSearch: false })
    expect(requestFor({ model: 'gemini-3.5-flash-lite' }).tier).toBe('lite')
  })
})

describe('modelChain', () => {
  const fallbacks = { gemini: ['gemini-3.7-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'] }
  it('uses the key models per tier, then the provider fallbacks', () => {
    expect(modelChain(key('g', 'gemini'), requestFor({ model: 'lite' }), fallbacks)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3-flash-preview'])
  })
  it('never falls back to a lite model for a primary task', () => {
    expect(modelChain(key('g', 'gemini'), requestFor({}), fallbacks)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3-flash-preview'])
  })
  it('honours an explicit model only on keys of its provider', () => {
    const req = requestFor({ model: 'gemini-3.7-flash' })
    expect(modelChain(key('g', 'gemini'), req)[0]).toBe('gemini-3.7-flash')
    expect(modelChain(key('a', 'anthropic'), req)).toEqual(['claude-opus-5-5'])
    expect(modelChain(key('o', 'openai'), requestFor({ model: 'gemini-3.5-flash-lite' }))).toEqual(['gpt-5-mini'])
    // A model the key listed (Discover models) counts as its own even with an unknown name.
    expect(modelChain(key('c', 'custom', { models: ['house-model'] }), requestFor({ model: 'house-model' }))[0]).toBe('house-model')
  })
  it('a key without any model yields nothing', () => {
    expect(modelChain(key('c', 'custom', { primaryModel: '', liteModel: '' }), requestFor({}))).toEqual([])
  })
})

describe('planCandidates', () => {
  it('orders by priority; equal priorities rotate and every main model comes before any fallback', () => {
    const keys = [key('g1', 'gemini'), key('g2', 'gemini'), key('a1', 'anthropic', { priority: 200 })]
    const fb = { gemini: ['gemini-3.7-flash'] }
    expect(pairs(planCandidates(keys, requestFor({}), { fallbackModels: fb, rotate: 0 }))).toEqual(['g1:gemini-3.8-flash', 'g2:gemini-3.8-flash', 'g1:gemini-3.7-flash', 'g2:gemini-3.7-flash', 'a1:claude-opus-5-5'])
    expect(pairs(planCandidates(keys, requestFor({}), { fallbackModels: fb, rotate: 1 })).slice(0, 2)).toEqual(['g2:gemini-3.8-flash', 'g1:gemini-3.8-flash'])
  })

  it('a lower priority number goes first whatever the provider', () => {
    const keys = [key('g1', 'gemini'), key('a1', 'anthropic', { priority: 10 })]
    expect(pairs(planCandidates(keys, requestFor({ model: 'lite' }))).slice(0, 1)).toEqual(['a1:claude-haiku-5-5'])
  })

  it('round_robin ignores priority', () => {
    const keys = [key('a1', 'anthropic', { priority: 1 }), key('d1', 'deepseek', { priority: 50 })]
    expect(pairs(planCandidates(keys, requestFor({}), { routing: 'round_robin', rotate: 1 }))).toEqual(['d1:deepseek-chat', 'a1:claude-opus-5-5'])
  })

  it('sends pictures to vision keys first and text-only to the others as a fallback', () => {
    const keys = [key('d1', 'deepseek', { priority: 1 }), key('o1', 'openai', { priority: 50 })]
    const c = planCandidates(keys, requestFor({ images: [{}] }))
    expect(c.map((x) => [x.key.id, x.images])).toEqual([
      ['o1', true],
      ['d1', false],
    ])
  })

  it('keeps web search on search-capable keys first and drops the flag elsewhere', () => {
    const keys = [key('o1', 'openai', { priority: 1 }), key('g1', 'gemini', { priority: 50 })]
    const c = planCandidates(keys, requestFor({ webSearch: true }))
    expect(c.map((x) => [x.key.id, x.webSearch])).toEqual([
      ['g1', true],
      ['o1', false],
    ])
  })

  it('per-key capability overrides count', () => {
    const keys = [key('c1', 'custom', { capabilities: { jsonSchema: 'prompt', vision: true, webSearch: false } }), key('d1', 'deepseek')]
    expect(planCandidates(keys, requestFor({ images: [{}] }))[0].key.id).toBe('c1')
  })
})
