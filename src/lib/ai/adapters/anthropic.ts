import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { AiHttpError, fetchWithTimeout, parseRetryAfter, readErrorMessage, redactKeys, type Adapter, type AdapterCall, type AdapterResult, type ClassifiedError, type KeyTestResult } from './types'

/**
 * Claude through the Anthropic SDK, one client per pooled key: structured output from the zod
 * schema, effort, the web_search tool (with pause_turn continuation) and image blocks.
 */

const DEFAULT_BASE = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'
// Thinking counts toward max_tokens, so tiny budgets from callers written for other models get a floor.
const MIN_MAX_TOKENS = 4096

/** Claude declined the request: retrying elsewhere with the same prompt is not useful. */
export class AiRefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiRefusalError'
  }
}

const clients = new Map<string, Anthropic>()

function clientFor(apiKey: string, baseUrl: string): Anthropic {
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : DEFAULT_BASE
  const id = `${base}|${apiKey}`
  let c = clients.get(id)
  if (!c) {
    // The SDK retries 408/409/429/5xx itself (honouring retry-after); kept low so the router can move to another key.
    c = new Anthropic({ apiKey, baseURL: base, maxRetries: 2, timeout: 5 * 60_000 })
    clients.set(id, c)
  }
  return c
}

type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const IMAGE_MIMES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

async function call(c: AdapterCall): Promise<AdapterResult> {
  const anthropic = clientFor(c.apiKey, c.baseUrl)
  const images = (c.images ?? []).filter((i) => IMAGE_MIMES.has(i.mimeType))
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mimeType as ImageMime, data: i.data } })),
    { type: 'text' as const, text: c.prompt },
  ]
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: images.length ? content : c.prompt }]
  // Structured output when the router asked for the native schema; otherwise the schema is already in the prompt.
  const schema = c.zodSchema && c.jsonMode === 'native' ? c.zodSchema : undefined
  let inputTokens = 0
  let outputTokens = 0
  // Web search can pause a long turn; continue it a few times.
  for (let turn = 0; turn < 4; turn++) {
    const msg = await anthropic.beta.messages
      .stream({
        model: c.model,
        max_tokens: Math.max(MIN_MAX_TOKENS, c.maxOutputTokens ?? 16000),
        ...(c.system ? { system: c.system } : {}),
        messages,
        output_config: {
          effort: c.effort ?? 'medium',
          ...(schema ? { format: zodOutputFormat(schema) } : {}),
        },
        ...(c.webSearch && !c.jsonSchema ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] } : {}),
        // Large shared system prompts (profile, style rules) are cached across drafts.
        cache_control: { type: 'ephemeral' },
        // On a safety decline the API retries on a suitable model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
      .finalMessage()
    inputTokens += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0)
    outputTokens += msg.usage.output_tokens ?? 0
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content })
      continue
    }
    if (msg.stop_reason === 'refusal') throw new AiRefusalError(`Claude declined the request (${msg.stop_details?.category ?? 'no category'})`)
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (!text.trim()) throw new Error(`Empty response from ${c.model} (stop_reason=${msg.stop_reason})`)
    return { text, usage: { inputTokens, outputTokens }, finishReason: msg.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : String(msg.stop_reason) }
  }
  throw new Error(`${c.model} kept pausing (web search); giving up`)
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name)
  const v = (headers as Record<string, string | undefined>)[name]
  return typeof v === 'string' ? v : null
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as { status?: number; message?: string; headers?: unknown; retryAfterMs?: number }
  const message = redactKeys(e?.message ?? String(err))
  if (err instanceof AiRefusalError) return { kind: 'bad_request', status: 400, message }
  const status = typeof e?.status === 'number' ? e.status : 0
  if (status === 401 || status === 403) return { kind: 'auth', status, message }
  if (/credit balance|billing|insufficient.*(credit|funds|balance)|purchase credits/i.test(message)) return { kind: 'billing', status, message }
  if (status === 429) return { kind: /per day|daily/i.test(message) ? 'daily' : 'rate', status, message, retryAfterMs: e.retryAfterMs ?? parseRetryAfter(headerValue(e.headers, 'retry-after')) }
  if (status >= 500 || status === 0 || status === 408 || status === 409) return { kind: 'server', status, message }
  return { kind: 'bad_request', status, message }
}

async function listModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '')
  const out: string[] = []
  let after = ''
  for (let page = 0; page < 5; page++) {
    const res = await fetchWithTimeout(`${base}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`, { headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION } }, 15_000)
    if (!res.ok) throw new AiHttpError(res.status, redactKeys(await readErrorMessage(res)), parseRetryAfter(res.headers.get('retry-after')))
    const j = (await res.json()) as { data?: Array<{ id?: string }>; has_more?: boolean; last_id?: string }
    for (const m of j.data ?? []) if (m.id) out.push(m.id)
    if (!j.has_more || !j.last_id) break
    after = j.last_id
  }
  return out
}

async function testKey(apiKey: string, baseUrl: string): Promise<KeyTestResult> {
  try {
    return { ok: true, models: await listModels(apiKey, baseUrl) }
  } catch (err) {
    return { ok: false, error: classifyError(err).message }
  }
}

export const anthropicAdapter: Adapter = { call, classifyError, testKey, listModels }

/** USD per million tokens (input, output) for the rough cost estimate on the dashboard. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [1, 5],
  'claude-haiku-4-5': [1, 5],
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model]
  if (!p) return 0
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000
}
