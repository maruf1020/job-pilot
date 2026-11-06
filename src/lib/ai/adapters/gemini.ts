import { GoogleGenAI } from '@google/genai'
import { toGeminiSchema } from '../schemas'
import { AiHttpError, fetchWithTimeout, readErrorMessage, redactKeys, type Adapter, type AdapterCall, type AdapterResult, type ClassifiedError, type KeyTestResult } from './types'

/** Google Gemini through @google/genai: native JSON schema, Google Search grounding, inline images. */

// Thinking tokens count against maxOutputTokens on the newer Flash models, so the
// default is generous; the actual cost is only what the model emits.
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'

/** True when the 429 is the per-day quota rather than the per-minute one. */
export function isDailyQuotaError(message: string): boolean {
  return /PerDay|per day|RequestsPerDay|daily/i.test(message)
}

async function call(c: AdapterCall): Promise<AdapterResult> {
  const custom = c.baseUrl && c.baseUrl.replace(/\/$/, '') !== DEFAULT_BASE
  const client = new GoogleGenAI({ apiKey: c.apiKey, ...(custom ? { httpOptions: { baseUrl: c.baseUrl } } : {}) })
  // Native schema only when the key is set to it; otherwise the router already put the schema in the prompt.
  const responseJsonSchema = c.zodSchema && c.jsonMode === 'native' ? toGeminiSchema(c.zodSchema) : undefined
  const wantsJson = Boolean(c.jsonSchema) && c.jsonMode !== 'prompt'
  const res = await client.models.generateContent({
    model: c.model,
    contents: c.images?.length ? [{ role: 'user', parts: [{ text: c.prompt }, ...c.images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))] }] : c.prompt,
    config: {
      systemInstruction: c.system,
      temperature: c.temperature ?? 0.7,
      maxOutputTokens: c.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(responseJsonSchema ? { responseMimeType: 'application/json', responseJsonSchema } : wantsJson ? { responseMimeType: 'application/json' } : {}),
      ...(c.webSearch && !c.jsonSchema ? { tools: [{ googleSearch: {} }] } : {}),
    },
  })
  const text = res.text ?? ''
  const finishReason = String(res.candidates?.[0]?.finishReason ?? 'unknown')
  if (!text.trim()) throw new Error(`Empty response from ${c.model} (finishReason=${finishReason})`)
  return {
    text,
    usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0 },
    finishReason,
  }
}

interface GenAiErrorLike {
  status?: number
  code?: number
  message?: string
  retryAfterMs?: number
}

function classifyError(err: unknown): ClassifiedError {
  const e = err as GenAiErrorLike
  const message = redactKeys(e?.message ?? String(err))
  let status = typeof e?.status === 'number' ? e.status : typeof e?.code === 'number' ? e.code : 0
  if (!status) {
    if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) status = 429
    else if (/503|UNAVAILABLE|overloaded/i.test(message)) status = 503
    else if (/5\d\d|INTERNAL/i.test(message)) status = 500
    else if (/401|403|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message)) status = 401
    else if (/400|INVALID_ARGUMENT/i.test(message)) status = 400
  }
  const delay = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(message) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(message)
  const retryAfterMs = e?.retryAfterMs ?? (delay ? Math.ceil(Number(delay[1]) * 1000) : undefined)
  // Gemini answers a bad key with 400 INVALID_ARGUMENT "API key not valid".
  if (/API key not valid|API_KEY_INVALID|API key expired|PERMISSION_DENIED|UNAUTHENTICATED/i.test(message) || status === 401 || status === 403) return { kind: 'auth', status: status || 401, message }
  if (/billing|prepayment|credits? (are )?depleted/i.test(message)) return { kind: 'billing', status, message }
  if (status === 429) return { kind: isDailyQuotaError(message) ? 'daily' : 'rate', status, message, retryAfterMs }
  if (status >= 500 || status === 0) return { kind: 'server', status, message }
  return { kind: 'bad_request', status, message }
}

async function listModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const base = (baseUrl || DEFAULT_BASE).replace(/\/$/, '')
  const out: string[] = []
  let pageToken = ''
  for (let page = 0; page < 5; page++) {
    const res = await fetchWithTimeout(`${base}/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: { 'x-goog-api-key': apiKey } }, 15_000)
    if (!res.ok) throw new AiHttpError(res.status, redactKeys(await readErrorMessage(res)))
    const j = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string }
    for (const m of j.models ?? []) {
      if (!m.name) continue
      if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue
      out.push(m.name.replace(/^models\//, ''))
    }
    if (!j.nextPageToken) break
    pageToken = j.nextPageToken
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

export const geminiAdapter: Adapter = { call, classifyError, testKey, listModels }
