import type { z } from 'zod'
import { db } from '@/lib/db'
import type { AiTask } from '@/lib/domain'
import { getSettings } from '@/lib/settings/service'
import type { AiConfig } from '@/lib/settings/schema'
import { Semaphore } from '@/lib/utils/semaphore'
import { adapterFor } from './adapters'
import { DEFAULT_MAX_OUTPUT_TOKENS } from './adapters/gemini'
import { toOpenAiStrictSchema, jsonInstruction, stripNulls, zodToJsonSchema } from './json-schema'
import {
  blockState,
  loadPool,
  nextRotation,
  NoKeyAvailableError,
  reportKeyDown,
  reportKeyError,
  reportKeyRateLimited,
  reportKeySuccess,
  reportModelExhausted,
  reserveKey,
} from './key-pool'
import { providerOrCustom, type JsonMode } from './providers'
import { planCandidates, requestFor, type Candidate } from './router'

/**
 * The one entry point for AI calls (re-exported from '@/lib/ai/gemini', where every caller imports
 * it). Keys of any provider are tried in priority order; JSON validation, repair and the retry on
 * a bad answer are the same whichever provider answered.
 */

export { NoKeyAvailableError }

export interface Usage {
  inputTokens: number
  outputTokens: number
  durationMs: number
}

export interface GenerateOptions {
  task: AiTask
  system?: string
  prompt: string
  /** 'primary' | 'lite' | explicit model id (honoured on keys of the provider that serves it, else mapped to its tier) */
  model?: 'primary' | 'lite' | (string & {})
  temperature?: number
  maxOutputTokens?: number
  /** Ground the answer with web search where the key supports it (text mode only; dropped elsewhere). */
  webSearch?: boolean
  /** Pictures sent with the prompt (a screenshot of a stuck form); vision keys first, others get the text only. */
  images?: Array<{ mimeType: string; data: string }>
}

export interface GenerateJsonOptions<T> extends GenerateOptions {
  schema: z.ZodType<T>
}

export interface GenerateResult<T> {
  data: T
  raw: string
  usage: Usage
  model: string
  keyId: string
}

/** Web search allowance gone (Gemini grounding has its own small free quota); the call is not retried. */
export class GroundingQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroundingQuotaError'
  }
}

const semaphores = new Map<string, { limit: number; sem: Semaphore }>()

/** Concurrency is bounded per provider: one provider's slow calls do not hold back another's. */
function semaphoreFor(provider: string, limit: number): Semaphore {
  const cur = semaphores.get(provider)
  if (cur && cur.limit === limit) return cur.sem
  const sem = new Semaphore(limit)
  semaphores.set(provider, { limit, sem })
  return sem
}

function extractJson(text: string): string {
  const t = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fenced) return fenced[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}

/** Escape raw line breaks and tabs that some models emit inside JSON string literals. */
export function escapeNewlinesInStrings(raw: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of raw) {
    if (inString) {
      if (escaped) {
        escaped = false
        out += ch
        continue
      }
      if (ch === '\\') {
        escaped = true
        out += ch
        continue
      }
      if (ch === '"') inString = false
      else if (ch === '\n') {
        out += '\\n'
        continue
      } else if (ch === '\r') continue
      else if (ch === '\t') {
        out += '\\t'
        continue
      }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}

/**
 * Parse model output as JSON; when the output was cut off mid-array (token limit),
 * drop the incomplete trailing element and close the open brackets.
 */
export function parseModelJson(text: string): unknown {
  const raw = extractJson(text)
  try {
    return JSON.parse(raw)
  } catch (first) {
    // Raw newlines inside strings (common in multi-paragraph email bodies).
    try {
      return JSON.parse(escapeNewlinesInStrings(raw))
    } catch {
      /* fall through to the truncation repair */
    }
    // Walk back to the last complete object inside the outermost array and close it.
    const arrayStart = raw.indexOf('[')
    if (arrayStart < 0) throw first
    let cut = raw.lastIndexOf('}')
    while (cut > arrayStart) {
      const candidate = `${raw.slice(0, cut + 1)}]}`
      try {
        return JSON.parse(candidate)
      } catch {
        cut = raw.lastIndexOf('}', cut - 1)
      }
    }
    throw first
  }
}

async function logUsage(keyId: string | null, provider: string, model: string, task: AiTask, usage: Usage, ok: boolean, error?: string) {
  await db.aiUsage
    .create({ data: { keyId, provider, model, task, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, durationMs: usage.durationMs, ok, error: error?.slice(0, 500) } })
    .catch(() => undefined)
}

/**
 * Generate text through the key pool. 429 -> next key (the limited one cools down); daily quota or
 * a rejected key -> next key or model; 5xx -> short backoff and retry; other 4xx -> fail fast.
 */
export async function generateText(opts: GenerateOptions): Promise<Omit<GenerateResult<string>, 'data'> & { text: string }> {
  const settings = await getSettings()
  const r = await dispatch(opts, undefined, settings.ai)
  return { text: r.text, raw: r.text, usage: r.usage, model: r.model, keyId: r.keyId }
}

/**
 * Generate JSON validated by a zod schema. On a validation failure it retries once
 * with the validator's message appended to the prompt.
 */
export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<GenerateResult<T>> {
  const settings = await getSettings()
  const json = { zod: opts.schema as z.ZodType, jsonSchema: zodToJsonSchema(opts.schema) }

  let lastError = ''
  let truncated = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? opts.prompt : `${opts.prompt}\n\nYour previous answer was not valid. Fix this and answer again with JSON only:\n${lastError}`
    // A cut-off answer gets a doubled budget on the retry instead of a nudge in the prompt.
    const maxOutputTokens = truncated ? (opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) * 2 : opts.maxOutputTokens
    const r = await dispatch({ ...opts, prompt: truncated ? opts.prompt : prompt, maxOutputTokens, temperature: attempt === 0 ? opts.temperature : Math.max(0.2, (opts.temperature ?? 0.7) - 0.3) }, json, settings.ai)
    let parsed: unknown
    try {
      parsed = parseModelJson(r.text)
    } catch (e) {
      truncated = r.finishReason === 'MAX_TOKENS'
      lastError = `Response was not JSON (${e instanceof Error ? e.message : 'parse error'}; finishReason=${r.finishReason}, model=${r.model})`
      continue
    }
    let v = opts.schema.safeParse(parsed)
    // Strict structured outputs answer null for optional fields; try again without them.
    if (!v.success) {
      const again = opts.schema.safeParse(stripNulls(parsed))
      if (again.success) v = again
    }
    if (v.success) return { data: v.data, raw: r.text, usage: r.usage, model: r.model, keyId: r.keyId }
    lastError = v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  }
  throw new Error(`The model returned invalid JSON for task "${opts.task}": ${lastError}`)
}

/** How this key takes the schema: native only when the provider can enforce this particular schema. */
export function effectiveJsonMode(cand: Pick<Candidate, 'key'>, jsonSchema: Record<string, unknown>): JsonMode {
  const mode = cand.key.capabilities.jsonSchema
  if (mode === 'native' && providerOrCustom(cand.key.provider).adapter === 'openai' && !toOpenAiStrictSchema(jsonSchema).strict) return 'json_object'
  return mode
}

const MODEL_GONE = /model.*(not found|does not exist|unsupported|not supported|no such|decommissioned|deprecated)|unknown model|invalid model/i

interface DispatchResult {
  text: string
  usage: Usage
  keyId: string
  model: string
  finishReason: string
}

async function dispatch(opts: GenerateOptions, json: { zod: z.ZodType; jsonSchema: Record<string, unknown> } | undefined, ai: AiConfig): Promise<DispatchResult> {
  const keys = await loadPool()
  if (keys.length === 0) throw new NoKeyAvailableError('No AI key configured. Add one in Settings > AI keys (or import your .env there).')
  const req = requestFor(opts)
  const cands = planCandidates(keys, req, { fallbackModels: ai.fallbackModels, routing: ai.routing, rotate: nextRotation() })
  if (cands.length === 0) throw new NoKeyAvailableError('No AI key has a model set for this task (set a primary/lite model on the key).')

  const skipped = new Set<number>()
  let serverErrors = 0
  let lastErr: unknown
  let lastReason = ''
  const maxAttempts = 3 + cands.length * 2
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // First usable candidate; when only cooling ones are left, wait for the soonest (short waits only).
    let pick = -1
    let soonest = Number.POSITIVE_INFINITY
    const now = Date.now()
    for (let i = 0; i < cands.length; i++) {
      if (skipped.has(i)) continue
      const s = await blockState(cands[i].key, cands[i].model, ai, now)
      if (!s.blocked) {
        pick = i
        break
      }
      lastReason = s.reason
      if (s.until) soonest = Math.min(soonest, s.until)
    }
    if (pick < 0) {
      if (Number.isFinite(soonest) && soonest - now < 90_000) {
        await new Promise((r) => setTimeout(r, soonest - now + 250))
        continue
      }
      if (lastErr && !(lastErr instanceof NoKeyAvailableError) && skipped.size === cands.length) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
      throw new NoKeyAvailableError(`No AI key can take this call now${lastReason ? ` (${lastReason})` : ''}`)
    }

    const cand = cands[pick]
    const { key, model } = cand
    const adapter = adapterFor(key.provider)
    const jsonMode = json ? effectiveJsonMode(cand, json.jsonSchema) : undefined
    const prompt = json && jsonMode !== 'native' ? `${opts.prompt}${jsonInstruction(json.jsonSchema)}` : opts.prompt
    reserveKey(key, model)
    const started = Date.now()
    try {
      const r = await semaphoreFor(key.provider, ai.concurrency).run(() =>
        adapter.call({
          providerId: key.provider,
          apiKey: key.apiKey,
          baseUrl: key.baseUrl,
          model,
          system: opts.system,
          prompt,
          images: cand.images ? opts.images : undefined,
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          jsonSchema: json?.jsonSchema,
          zodSchema: json?.zod,
          jsonMode,
          webSearch: cand.webSearch,
          effort: ai.effort[req.tier],
        }),
      )
      const usage: Usage = { ...r.usage, durationMs: Date.now() - started }
      await reportKeySuccess(key.id, key.provider)
      await logUsage(key.id, key.provider, model, opts.task, usage, true)
      return { text: r.text, usage, keyId: key.id, model, finishReason: r.finishReason }
    } catch (err) {
      lastErr = err
      const c = adapter.classifyError(err)
      await logUsage(key.id, key.provider, model, opts.task, { inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started }, false, `${c.status} ${c.message}`)
      switch (c.kind) {
        case 'rate':
          // Grounded calls on Gemini: the search allowance is separate from the model quota and the
          // error carries no quota id. Try another search-capable key; when none is left, the caller
          // disables search for today.
          if (cand.webSearch && key.provider === 'gemini') {
            skipped.add(pick)
            if (!cands.some((x, i) => !skipped.has(i) && x.webSearch)) throw new GroundingQuotaError(c.message)
            continue
          }
          await reportKeyRateLimited(key.id, c.message, c.retryAfterMs)
          continue
        case 'daily':
          await reportModelExhausted(key.id, model, c.message, key.provider)
          continue
        case 'auth':
        case 'billing':
          await reportKeyDown(key.id, `${c.kind === 'auth' ? 'Key rejected' : 'No credit'}: ${c.message}`, key.provider)
          continue
        case 'server':
          serverErrors++
          await reportKeyError(key.id, c.message)
          // Overloaded or empty: every second failure moves on to the next candidate.
          if (serverErrors % 2 === 0) skipped.add(pick)
          await new Promise((r) => setTimeout(r, Math.min(10_000, 1000 * 2 ** Math.min(serverErrors - 1, 3))))
          continue
        case 'bad_request':
          // A model this key cannot use (renamed, not enabled for the account): skip it for today, not the call.
          if (MODEL_GONE.test(c.message)) {
            await reportModelExhausted(key.id, model, c.message, key.provider)
            continue
          }
          await reportKeyError(key.id, c.message)
          throw err
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'AI call failed'))
}

/** Cheap connectivity check (Settings > AI "Test"): one tiny call through the router. */
export async function testAi(): Promise<{ ok: boolean; model: string; text: string; ms: number; keyId: string }> {
  const started = Date.now()
  const r = await generateText({ task: 'test', prompt: 'Reply with the single word OK.', model: 'lite', temperature: 0, maxOutputTokens: 256 })
  return { ok: /ok/i.test(r.text), model: r.model, text: r.text.trim(), ms: Date.now() - started, keyId: r.keyId }
}

/** @deprecated Name kept for older imports; same as testAi. */
export const testGemini = testAi
