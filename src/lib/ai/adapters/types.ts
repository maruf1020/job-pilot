import type { z } from 'zod'
import type { JsonMode } from '../providers'

/** One request to one model on one key. Every adapter takes the same shape. */
export interface AdapterCall {
  providerId: string
  apiKey: string
  baseUrl: string
  model: string
  system?: string
  prompt: string
  /** Base64 pictures; only sent to vision-capable keys (the router drops them otherwise). */
  images?: Array<{ mimeType: string; data: string }>
  temperature?: number
  maxOutputTokens?: number
  /** JSON schema of the expected answer (draft-7, from the zod schema). Absent = free text. */
  jsonSchema?: Record<string, unknown>
  /** The zod schema itself (Anthropic builds its structured output from it). */
  zodSchema?: z.ZodType
  /** How this key enforces JSON. */
  jsonMode?: JsonMode
  webSearch?: boolean
  /** Thinking effort where the model supports it (Anthropic effort, OpenAI reasoning_effort). */
  effort?: 'low' | 'medium' | 'high'
}

export interface AdapterResult {
  text: string
  usage: { inputTokens: number; outputTokens: number }
  /** 'MAX_TOKENS' when the answer was cut off (the JSON retry doubles the budget); otherwise the provider's reason. */
  finishReason: string
}

export type ErrorKind = 'rate' | 'daily' | 'auth' | 'billing' | 'server' | 'bad_request'

export interface ClassifiedError {
  kind: ErrorKind
  message: string
  status: number
  retryAfterMs?: number
}

export interface KeyTestResult {
  ok: boolean
  error?: string
  models?: string[]
}

export interface Adapter {
  call(c: AdapterCall): Promise<AdapterResult>
  classifyError(err: unknown): ClassifiedError
  /** Cheap check that the key works (lists the models where the API allows it). */
  testKey(apiKey: string, baseUrl: string, providerId?: string): Promise<KeyTestResult>
  listModels(apiKey: string, baseUrl: string): Promise<string[]>
}

/** Error from a plain fetch adapter: keeps the HTTP status and the Retry-After hint. */
export class AiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'AiHttpError'
  }
}

/** Retry-After header (seconds or an HTTP date) in ms. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

/** fetch with a timeout; network failures surface as status 0 (treated as a server error). */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    const msg = err instanceof Error ? (err.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : err.message) : String(err)
    throw new AiHttpError(0, `Network error: ${msg}`)
  } finally {
    clearTimeout(timer)
  }
}

/** The error message a JSON API returned ({error: {message}} or {error: "..."} or {message}). */
export async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text) as { error?: { message?: string; type?: string; code?: string } | string; message?: string; detail?: string }
    const e = j.error
    if (typeof e === 'string') return e
    if (e?.message) return [e.message, e.type, e.code].filter(Boolean).join(' | ')
    if (j.message) return j.message
    if (j.detail) return typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
  } catch {
    // not JSON
  }
  return text.slice(0, 500) || res.statusText || `HTTP ${res.status}`
}

/** Remove anything that looks like a key from an error message before it is stored or shown. */
export function redactKeys(message: string): string {
  return message.replace(/(AIza[\w-]{10,}|AQ\.[\w.-]{10,}|sk-[\w-]{10,}|gsk_\w{10,}|xai-[\w-]{10,}|pplx-[\w-]{10,}|csk-[\w-]{10,}|fw_[\w-]{10,}|tgp_[\w-]{10,})/g, '[key]')
}
