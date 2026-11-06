import { toOpenAiStrictSchema } from '../json-schema'
import { getProvider } from '../providers'
import { AiHttpError, fetchWithTimeout, parseRetryAfter, readErrorMessage, redactKeys, type Adapter, type AdapterCall, type AdapterResult, type ClassifiedError, type KeyTestResult } from './types'

/**
 * Every OpenAI-compatible chat/completions API (OpenAI, DeepSeek, Kimi, Groq, OpenRouter, Mistral,
 * xAI, Together, Fireworks, Cerebras, Perplexity, Qwen, GLM, Ollama, LM Studio, custom) with plain
 * fetch, so no SDK per provider.
 */

const CALL_TIMEOUT_MS = 5 * 60_000
const DEFAULT_MAX_OUTPUT_TOKENS = 16384
/** Many hosted models refuse max_tokens above this; used for the one retry after a "max_tokens too large" 400. */
const SAFE_MAX_TOKENS = 8192

/** o-series and GPT-5 models take max_completion_tokens and no temperature. */
export function isReasoningModel(model: string, providerId: string): boolean {
  if (providerId === 'openrouter') return false
  const bare = model.replace(/^openai\//, '')
  return /^(o\d|gpt-5)/i.test(bare)
}

function headers(apiKey: string, providerId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(providerId === 'openrouter' ? { 'X-Title': 'job-pilot' } : {}),
  }
}

export function buildChatBody(c: AdapterCall, overrides: { maxTokens?: number; noTemperature?: boolean } = {}): Record<string, unknown> {
  const reasoning = isReasoningModel(c.model, c.providerId)
  const images = c.images ?? []
  const userContent = images.length
    ? [{ type: 'text', text: c.prompt }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))]
    : c.prompt
  const body: Record<string, unknown> = {
    model: c.model,
    messages: [...(c.system ? [{ role: 'system', content: c.system }] : []), { role: 'user', content: userContent }],
  }
  const max = overrides.maxTokens ?? c.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  if (reasoning) {
    body.max_completion_tokens = max
    if (c.effort && c.providerId === 'openai') body.reasoning_effort = c.effort
  } else {
    body.max_tokens = max
    if (!overrides.noTemperature) body.temperature = c.temperature ?? 0.7
  }
  if (c.jsonSchema && c.jsonMode !== 'prompt') {
    const strict = c.jsonMode === 'native' ? toOpenAiStrictSchema(c.jsonSchema) : null
    body.response_format = strict?.strict ? { type: 'json_schema', json_schema: { name: 'response', strict: true, schema: strict.schema } } : { type: 'json_object' }
  }
  // OpenRouter's web plugin; Perplexity's sonar models search on their own.
  if (c.webSearch && !c.jsonSchema && c.providerId === 'openrouter') body.plugins = [{ id: 'web' }]
  return body
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> | null; refusal?: string | null }; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string; code?: number | string } | string
}

async function post(c: AdapterCall, body: Record<string, unknown>): Promise<ChatResponse> {
  const base = c.baseUrl.replace(/\/$/, '')
  const res = await fetchWithTimeout(`${base}/chat/completions`, { method: 'POST', headers: headers(c.apiKey, c.providerId), body: JSON.stringify(body) }, CALL_TIMEOUT_MS)
  if (!res.ok) throw new AiHttpError(res.status, redactKeys(await readErrorMessage(res)), parseRetryAfter(res.headers.get('retry-after')))
  const j = (await res.json()) as ChatResponse
  // Some gateways (OpenRouter) answer 200 with an error body.
  if (j.error) {
    const e = j.error
    const msg = typeof e === 'string' ? e : (e.message ?? 'error')
    const code = typeof e === 'object' && Number.isFinite(Number(e.code)) ? Number(e.code) : 500
    throw new AiHttpError(code, redactKeys(msg))
  }
  return j
}

async function call(c: AdapterCall): Promise<AdapterResult> {
  if (!c.baseUrl) throw new AiHttpError(400, 'This key has no base URL')
  let j: ChatResponse
  try {
    j = await post(c, buildChatBody(c))
  } catch (err) {
    // One retry for parameter mismatches that differ per model: an output cap above the model's maximum, or no temperature support.
    if (!(err instanceof AiHttpError) || err.status !== 400) throw err
    const tooMany = /max_tokens|max_completion_tokens|maximum.*tokens|too large|output tokens/i.test(err.message) && (c.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) > SAFE_MAX_TOKENS
    const temp = /temperature/i.test(err.message)
    if (!tooMany && !temp) throw err
    j = await post(c, buildChatBody(c, { ...(tooMany ? { maxTokens: SAFE_MAX_TOKENS } : {}), noTemperature: temp }))
  }
  const choice = j.choices?.[0]
  const msg = choice?.message
  if (msg?.refusal) throw new AiHttpError(400, `The model declined: ${msg.refusal}`)
  const raw = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((p) => p.text ?? '').join('') : ''
  // Reasoning models served through some gateways put their thinking inline.
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '')
  const text = stripped.trim() ? stripped : raw
  const finishReason = choice?.finish_reason === 'length' ? 'MAX_TOKENS' : String(choice?.finish_reason ?? 'unknown')
  // A reasoning model that spent the whole budget thinking returns nothing; for JSON the caller doubles the budget.
  if (!text.trim() && !(finishReason === 'MAX_TOKENS' && c.jsonSchema)) throw new Error(`Empty response from ${c.model} (finish_reason=${finishReason})`)
  return { text, usage: { inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 }, finishReason }
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as { status?: number; message?: string; retryAfterMs?: number }
  const message = redactKeys(e?.message ?? String(err))
  const status = typeof e?.status === 'number' ? e.status : 0
  if (status === 401 || status === 403) return { kind: 'auth', status, message }
  if (status === 402 || /insufficient_quota|insufficient balance|insufficient credits|exceeded your current quota|billing|payment required|credit balance|out of credits/i.test(message)) return { kind: 'billing', status, message }
  if (status === 429) return { kind: /per day|daily|\bRPD\b|\bTPD\b|requests per day|tokens per day/i.test(message) ? 'daily' : 'rate', status, message, retryAfterMs: e.retryAfterMs }
  if (status >= 500 || status === 0 || status === 408) return { kind: 'server', status, message }
  return { kind: 'bad_request', status, message }
}

async function listModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  if (!base) throw new AiHttpError(400, 'No base URL')
  const res = await fetchWithTimeout(`${base}/models`, { headers: headers(apiKey, '') }, 15_000)
  if (!res.ok) throw new AiHttpError(res.status, redactKeys(await readErrorMessage(res)), parseRetryAfter(res.headers.get('retry-after')))
  const j = (await res.json()) as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string; model?: string }> }
  const list = j.data ?? j.models ?? []
  return [...new Set(list.map((m) => m.id ?? (m as { model?: string }).model ?? m.name ?? '').filter(Boolean))]
}

/**
 * Providers whose model list is public (it answers 200 without a key), with an endpoint that does
 * check the key. Without this a made-up OpenRouter key tested as "works".
 */
const KEY_CHECK_PATH: Record<string, string> = { openrouter: '/key' }

async function testKey(apiKey: string, baseUrl: string, providerId = 'custom'): Promise<KeyTestResult> {
  try {
    const check = KEY_CHECK_PATH[providerId]
    if (check) {
      const res = await fetchWithTimeout(`${baseUrl.replace(/\/$/, '')}${check}`, { headers: headers(apiKey, '') }, 15_000)
      if (!res.ok) throw new AiHttpError(res.status, redactKeys(await readErrorMessage(res)), parseRetryAfter(res.headers.get('retry-after')))
    }
    return { ok: true, models: await listModels(apiKey, baseUrl) }
  } catch (err) {
    const c = classifyError(err)
    // No model list on this API (Perplexity): one tiny chat call instead.
    if (c.status === 404 || c.status === 405) {
      const model = getProvider(providerId)?.defaultLite
      if (!model) return { ok: false, error: c.message }
      try {
        await call({ providerId, apiKey, baseUrl, model, prompt: 'Reply with the single word OK.', maxOutputTokens: 16, temperature: 0 })
        return { ok: true, models: [] }
      } catch (err2) {
        return { ok: false, error: classifyError(err2).message }
      }
    }
    return { ok: false, error: c.message }
  }
}

export const openAiCompatAdapter: Adapter = { call, classifyError, testKey, listModels }
