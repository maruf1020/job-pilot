import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { zodToJsonSchema } from '../json-schema'
import { anthropicAdapter, AiRefusalError } from './anthropic'
import { geminiAdapter } from './gemini'
import { buildChatBody, isReasoningModel, openAiCompatAdapter } from './openai-compat'
import { AiHttpError, type AdapterCall } from './types'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gemini classifyError', () => {
  const c = geminiAdapter.classifyError
  it('tells per-minute and per-day quota apart', () => {
    expect(c({ status: 429, message: 'Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier' }).kind).toBe('daily')
    const rate = c({ status: 429, message: 'RESOURCE_EXHAUSTED GenerateRequestsPerMinutePerProjectPerModel "retryDelay": "23s"' })
    expect(rate.kind).toBe('rate')
    expect(rate.retryAfterMs).toBe(23_000)
  })
  it('maps a bad key (400 API key not valid) to auth', () => {
    expect(c({ status: 400, message: 'API key not valid. Please pass a valid API key. API_KEY_INVALID' }).kind).toBe('auth')
    expect(c({ status: 403, message: 'PERMISSION_DENIED' }).kind).toBe('auth')
  })
  it('maps overloads and empty answers to server, other 4xx to bad_request', () => {
    expect(c({ status: 503, message: 'UNAVAILABLE overloaded' }).kind).toBe('server')
    expect(c(new Error('Empty response from gemini-3.8-flash (finishReason=SAFETY)')).kind).toBe('server')
    expect(c({ status: 400, message: 'INVALID_ARGUMENT bad schema' }).kind).toBe('bad_request')
    expect(c(new Error('got status 429 RESOURCE_EXHAUSTED')).kind).toBe('rate')
  })
  it('never echoes a key in the message', () => {
    expect(c({ status: 400, message: 'API key not valid: AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }).message).not.toContain('AIza')
  })
})

describe('anthropic classifyError', () => {
  const c = anthropicAdapter.classifyError
  it('maps the SDK errors', () => {
    expect(c(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers())).kind).toBe('auth')
    expect(c(new Anthropic.PermissionDeniedError(403, undefined, 'denied', new Headers())).kind).toBe('auth')
    const rate = c(new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers({ 'retry-after': '7' })))
    expect(rate).toMatchObject({ kind: 'rate', retryAfterMs: 7000 })
    expect(c(new Anthropic.BadRequestError(400, undefined, 'Your credit balance is too low to access the Anthropic API', new Headers())).kind).toBe('billing')
    expect(c(new Anthropic.InternalServerError(529, undefined, 'Overloaded', new Headers())).kind).toBe('server')
    expect(c(new Anthropic.BadRequestError(400, undefined, 'max_tokens: too large', new Headers())).kind).toBe('bad_request')
  })
  it('a refusal fails fast and a pause loop is a server error', () => {
    expect(c(new AiRefusalError('Claude declined the request')).kind).toBe('bad_request')
    expect(c(new Error('claude-opus-5-5 kept pausing (web search); giving up')).kind).toBe('server')
  })
})

describe('openai-compatible classifyError', () => {
  const c = openAiCompatAdapter.classifyError
  it('maps status codes and provider wording', () => {
    expect(c(new AiHttpError(401, 'Incorrect API key provided')).kind).toBe('auth')
    expect(c(new AiHttpError(402, 'Insufficient Balance')).kind).toBe('billing')
    expect(c(new AiHttpError(429, 'You exceeded your current quota, please check your plan and billing details. insufficient_quota')).kind).toBe('billing')
    expect(c(new AiHttpError(429, 'Rate limit reached for model llama-3.3-70b-versatile on requests per day (RPD): Limit 1000')).kind).toBe('daily')
    expect(c(new AiHttpError(429, 'Rate limit reached on tokens per min (TPM)', 1500))).toMatchObject({ kind: 'rate', retryAfterMs: 1500 })
    expect(c(new AiHttpError(500, 'boom')).kind).toBe('server')
    expect(c(new AiHttpError(0, 'Network error: timed out')).kind).toBe('server')
    expect(c(new AiHttpError(404, 'The model `gpt-9` does not exist')).kind).toBe('bad_request')
    expect(c(new AiHttpError(400, 'Invalid schema for response_format')).kind).toBe('bad_request')
  })
})

describe('openai-compatible request body', () => {
  const base: AdapterCall = { providerId: 'openai', apiKey: 'k', baseUrl: 'https://api.example.invalid/v1', model: 'gpt-4.1', prompt: 'Hi', system: 'Be brief' }

  it('normal models take max_tokens and temperature', () => {
    const b = buildChatBody({ ...base, temperature: 0.3, maxOutputTokens: 500 })
    expect(b).toMatchObject({ model: 'gpt-4.1', max_tokens: 500, temperature: 0.3 })
    expect(b.messages).toEqual([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
    ])
  })

  it('reasoning models take max_completion_tokens, no temperature, and the effort', () => {
    expect(isReasoningModel('o4-mini', 'openai')).toBe(true)
    expect(isReasoningModel('gpt-5', 'openai')).toBe(true)
    expect(isReasoningModel('openai/gpt-5', 'openrouter')).toBe(false)
    const b = buildChatBody({ ...base, model: 'gpt-5', temperature: 0.7, maxOutputTokens: 900, effort: 'low' })
    expect(b).toMatchObject({ max_completion_tokens: 900, reasoning_effort: 'low' })
    expect(b).not.toHaveProperty('temperature')
    expect(b).not.toHaveProperty('max_tokens')
  })

  it('sends pictures as image_url data URLs', () => {
    const b = buildChatBody({ ...base, images: [{ mimeType: 'image/png', data: 'AAAA' }] })
    const user = (b.messages as Array<{ role: string; content: unknown }>)[1]
    expect(user.content).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })

  it('uses a strict json_schema when native, json_object otherwise', () => {
    const jsonSchema = zodToJsonSchema(z.object({ a: z.string() }))
    const native = buildChatBody({ ...base, jsonSchema, jsonMode: 'native' })
    expect(native.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'response', strict: true } })
    expect(buildChatBody({ ...base, jsonSchema, jsonMode: 'json_object' }).response_format).toEqual({ type: 'json_object' })
    expect(buildChatBody({ ...base, jsonSchema, jsonMode: 'prompt' })).not.toHaveProperty('response_format')
    // A schema strict mode cannot express falls back to JSON mode.
    const loose = zodToJsonSchema(z.object({ m: z.record(z.string(), z.number()) }))
    expect(buildChatBody({ ...base, jsonSchema: loose, jsonMode: 'native' }).response_format).toEqual({ type: 'json_object' })
  })

  it('turns on the OpenRouter web plugin for search', () => {
    expect(buildChatBody({ ...base, providerId: 'openrouter', webSearch: true }).plugins).toEqual([{ id: 'web' }])
    expect(buildChatBody({ ...base, webSearch: true })).not.toHaveProperty('plugins')
  })
})

describe('openai-compatible calls (mocked fetch)', () => {
  const call: AdapterCall = { providerId: 'deepseek', apiKey: 'sk-test', baseUrl: 'https://api.example.invalid/v1/', model: 'deepseek-chat', prompt: 'Hi' }

  it('returns text, usage and normalises a cut-off answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: '{"a":' }, finish_reason: 'length' }], usage: { prompt_tokens: 12, completion_tokens: 34 } }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await openAiCompatAdapter.call(call)
    expect(r).toEqual({ text: '{"a":', usage: { inputTokens: 12, outputTokens: 34 }, finishReason: 'MAX_TOKENS' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.invalid/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('throws AiHttpError with the status and retry-after', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: { message: 'Too many requests' } }, { 'retry-after': '3' })))
    const err = await openAiCompatAdapter.call(call).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiHttpError)
    expect(openAiCompatAdapter.classifyError(err)).toMatchObject({ kind: 'rate', status: 429, retryAfterMs: 3000 })
  })

  it('retries once with a smaller output cap when the model rejects max_tokens', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: 'max_tokens is too large: 16384. This model supports at most 8192 completion tokens' } }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await openAiCompatAdapter.call(call)
    expect(r.text).toBe('ok')
    const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as { max_tokens: number }
    expect(second.max_tokens).toBe(8192)
  })

  it('lists models and tests a key without spending a call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] })))
    expect(await openAiCompatAdapter.listModels('sk-test', 'https://api.example.invalid/v1')).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(await openAiCompatAdapter.testKey('sk-test', 'https://api.example.invalid/v1', 'deepseek')).toEqual({ ok: true, models: ['deepseek-chat', 'deepseek-reasoner'] })
  })

  it('reports a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { message: 'Authentication Fails, Your api key: ****abcd is invalid' } })))
    const r = await openAiCompatAdapter.testKey('sk-test', 'https://api.example.invalid/v1', 'deepseek')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Authentication Fails')
  })
})

describe('model lists of the native adapters (mocked fetch)', () => {
  it('gemini keeps generateContent models and strips the prefix', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await geminiAdapter.listModels('AIza-test', '')).toEqual(['gemini-3.8-flash'])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test')
  })

  it('anthropic pages through /v1/models', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 'claude-opus-5-5' }], has_more: true, last_id: 'claude-opus-5-5' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 'claude-haiku-5-5' }], has_more: false }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await anthropicAdapter.listModels('sk-ant-test', '')).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(String((fetchMock.mock.calls[1] as unknown as [string])[0])).toContain('after_id=claude-opus-5-5')
  })

  it('a rejected gemini key fails the test as auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })))
    const r = await geminiAdapter.testKey('AIza-test', '')
    expect(r.ok).toBe(false)
    expect(geminiAdapter.classifyError(new AiHttpError(400, r.error ?? '')).kind).toBe('auth')
  })
})
