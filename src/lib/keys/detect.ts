import { PROVIDERS, getProvider, isLiteModel } from '@/lib/ai/providers'
import { serviceForEnvName } from './service-keys-defs'

/**
 * Pure parsing and detection for the key importer: pasted `.env` text, JSON or bare keys in,
 * entries with a detected provider (or service) out. No network here; probing lives in import.ts.
 */

export interface ParsedEntry {
  /** Variable or JSON path name ('' for a bare key). */
  name: string
  value: string
  /** 1-based line in the pasted text (0 for JSON input). */
  line: number
}

const NAME_LINE = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/

function unquote(raw: string): string {
  let v = raw.trim()
  if ((v.startsWith('"') && v.includes('"', 1)) || (v.startsWith("'") && v.includes("'", 1)) || (v.startsWith('`') && v.includes('`', 1))) {
    const q = v[0]
    v = v.slice(1, v.indexOf(q, 1))
    return v
  }
  // Unquoted: an inline comment starts at " #".
  const hash = v.search(/\s#/)
  if (hash >= 0) v = v.slice(0, hash)
  return v.trim().replace(/[;,]$/, '')
}

function looksLikeSecret(v: string): boolean {
  return v.length >= 16 && !/\s/.test(v) && !/^https?:\/\//i.test(v)
}

/** A comma/space separated list of keys in one variable (GEMINI_API_KEYS="a,b,c"). */
function splitList(value: string): string[] {
  const parts = value.split(/[\s,;]+/).filter(Boolean)
  return parts.length > 1 && parts.every(looksLikeSecret) ? parts : [value]
}

function flattenJson(node: unknown, path: string, out: ParsedEntry[]) {
  if (typeof node === 'string') {
    for (const v of splitList(node.trim())) if (v) out.push({ name: path, value: v, line: 0 })
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) flattenJson(item, path, out)
    return
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) flattenJson(v, path ? `${path}.${k}` : k, out)
  }
}

/** Parse pasted text: NAME=value lines (export, quotes, comments), JSON objects (flat or nested) or bare keys one per line. */
export function parseKeyText(text: string): ParsedEntry[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const out: ParsedEntry[] = []
      flattenJson(JSON.parse(trimmed), '', out)
      return out
    } catch {
      // Not JSON after all: read it line by line.
    }
  }
  const out: ParsedEntry[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue
    const m = NAME_LINE.exec(line)
    if (m && !/^https?$/i.test(m[1])) {
      const value = unquote(m[2])
      if (!value) continue
      for (const v of splitList(value)) out.push({ name: m[1], value: v, line: i + 1 })
      continue
    }
    // A bare key: one token, long enough to be a secret.
    const bare = unquote(line)
    if (looksLikeSecret(bare)) out.push({ name: '', value: bare, line: i + 1 })
  }
  return out
}

export type DetectedBy = 'name' | 'format' | 'probe' | 'unknown'

export type Detection =
  | { kind: 'ai'; provider: string; detectedBy: 'name' | 'format' }
  | { kind: 'ai'; provider?: undefined; candidates: string[]; detectedBy: 'unknown' }
  | { kind: 'service'; service: string; field: string; detectedBy: 'name' | 'format' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'ignore' }

/** Provider tokens in variable names (and JSON keys), checked in this order. */
const NAME_TOKENS: Array<[RegExp, string]> = [
  [/(^|_)OPENROUTER(_|$)/, 'openrouter'],
  [/(^|_)(ANTHROPIC|CLAUDE)(_|$)/, 'anthropic'],
  [/(^|_)(GEMINI|GOOGLE_AI|GOOGLE_GENAI|GOOGLE_API)(_|$)/, 'gemini'],
  [/(^|_)DEEPSEEK(_|$)/, 'deepseek'],
  [/(^|_)(MOONSHOT|KIMI)(_|$)/, 'moonshot'],
  [/(^|_)GROQ(_|$)/, 'groq'],
  [/(^|_)MISTRAL(_|$)/, 'mistral'],
  [/(^|_)(XAI|GROK)(_|$)/, 'xai'],
  [/(^|_)(TOGETHER|TOGETHERAI)(_|$)/, 'together'],
  [/(^|_)FIREWORKS(_|$)/, 'fireworks'],
  [/(^|_)CEREBRAS(_|$)/, 'cerebras'],
  [/(^|_)(PERPLEXITY|PPLX)(_|$)/, 'perplexity'],
  [/(^|_)(DASHSCOPE|QWEN|ALIBABA)(_|$)/, 'qwen'],
  [/(^|_)(ZHIPU|ZHIPUAI|GLM|ZAI)(_|$)/, 'zhipu'],
  [/(^|_)OLLAMA(_|$)/, 'ollama'],
  [/(^|_)(OPENAI|CODEX)(_|$)/, 'openai'],
]

/** Names that carry configuration, not a key (OPENAI_BASE_URL, GEMINI_MODEL, ...). */
const NOT_A_KEY = /(^|_)(URL|BASE|ENDPOINT|HOST|MODEL|MODELS|ORG|ORGANIZATION|PROJECT|PROJECT_ID|REGION|VERSION|TIMEOUT|DEPLOYMENT)(_|$)/
/** App secrets that are never provider keys. */
const APP_SECRETS = /^(AUTH_SECRET|NEXTAUTH_SECRET|APP_ENCRYPTION_KEY|JWT_SECRET|SESSION_SECRET|COOKIE_SECRET|GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_ID|DATABASE_URL|DIRECT_DATABASE_URL)$/

function normaliseName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^(NEXT_PUBLIC|VITE|REACT_APP|PUBLIC)_/, '')
    .replace(/_\d+$/, '')
    .replace(/^_+|_+$/g, '')
}

/** Provider by variable name, or null. Exported for tests. */
export function providerFromName(name: string): string | null {
  if (!name) return null
  const n = normaliseName(name)
  for (const p of PROVIDERS) if (p.envNames.includes(n)) return p.id
  if (NOT_A_KEY.test(n) && !/(KEY|TOKEN)$/.test(n)) return null
  for (const [re, id] of NAME_TOKENS) if (re.test(n)) return id
  return null
}

/** Formats that identify a provider for sure (checked before the name, so OPENAI_API_KEY=sk-or-... is OpenRouter). */
export function providerFromFormat(value: string): string | null {
  for (const p of PROVIDERS) if (p.keyPatterns.some((re) => re.test(value))) return p.id
  return null
}

/** Provider candidates for formats several providers share; probed live in import.ts. */
export function ambiguousCandidates(value: string): string[] {
  if (/^sk-[a-f0-9]{32}$/.test(value)) return ['deepseek', 'qwen']
  if (/^sk-[A-Za-z0-9]{48}$/.test(value)) return ['moonshot', 'openai']
  if (/^sk-[\w-]{20,}$/.test(value)) return ['openai', 'deepseek', 'moonshot', 'qwen']
  if (/^[A-Za-z0-9]{32}$/.test(value)) return ['mistral']
  return []
}

const TELEGRAM_TOKEN = /^\d{6,12}:[\w-]{30,}$/

/** What a parsed entry is: by variable name first, then key format; ambiguous formats return candidates. */
export function detectProvider(name: string, value: string): Detection {
  const v = value.trim()
  if (!v) return { kind: 'ignore' }
  // A Claude subscription sign-in token works only in Claude's own apps, never against the API.
  if (/^sk-ant-oat/.test(v)) return { kind: 'unsupported', reason: 'a Claude subscription sign-in token (sk-ant-oat...), not an API key; create an API key at console.anthropic.com' }
  if (/^sk-ant-admin/.test(v)) return { kind: 'unsupported', reason: 'an Anthropic admin key, which cannot call models; create a normal API key' }

  const n = name ? normaliseName(name.split('.').pop() ?? name) : ''
  const fullName = name ? normaliseName(name) : ''
  if (n && APP_SECRETS.test(n)) return { kind: 'ignore' }
  const svc = name ? serviceForEnvName(n) ?? serviceForEnvName(fullName) : null
  if (svc) return { kind: 'service', service: svc.service, field: svc.field, detectedBy: 'name' }

  const byFormat = providerFromFormat(v)
  const byName = providerFromName(fullName) ?? providerFromName(n)
  if (byFormat && byName && byFormat !== byName) return { kind: 'ai', provider: byFormat, detectedBy: 'format' }
  if (byName) {
    if (/^https?:\/\//i.test(v)) return { kind: 'ignore' }
    return { kind: 'ai', provider: byName, detectedBy: 'name' }
  }
  if (byFormat) return { kind: 'ai', provider: byFormat, detectedBy: 'format' }
  if (TELEGRAM_TOKEN.test(v)) return { kind: 'service', service: 'telegram', field: 'TELEGRAM_BOT_TOKEN', detectedBy: 'format' }

  // A named variable that is not about keys (PORT=3000, DATABASE_URL=...) is not an AI key.
  if (n && !/(KEY|TOKEN|SECRET|APIKEY|API)/.test(n)) return { kind: 'ignore' }
  if (!/^[\w.-]{16,}$/.test(v)) return { kind: 'ignore' }
  return { kind: 'ai', candidates: ambiguousCandidates(v), detectedBy: 'unknown' }
}

/** Suggested primary/lite models from a key's model list (the provider's defaults when listed or when no list exists). */
export function suggestModels(providerId: string, models: string[] = []): { primaryModel?: string; liteModel?: string } {
  const p = getProvider(providerId)
  if (!p) return {}
  if (!models.length) return { primaryModel: p.defaultPrimary || undefined, liteModel: p.defaultLite || undefined }
  const has = (m: string) => Boolean(m) && models.includes(m)
  const chatLike = models.filter((m) => !/embed|whisper|tts|dall-e|image|audio|moderation|realtime|transcribe|rerank|guard/i.test(m))
  const sorted = [...chatLike].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  const primaryModel = has(p.defaultPrimary) ? p.defaultPrimary : (sorted.find((m) => !isLiteModel(m)) ?? sorted[0] ?? (p.defaultPrimary || undefined))
  const liteModel = has(p.defaultLite) ? p.defaultLite : (sorted.find((m) => isLiteModel(m)) ?? primaryModel)
  return { primaryModel, liteModel }
}
