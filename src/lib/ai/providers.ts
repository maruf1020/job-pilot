/**
 * Every AI provider the app can talk to. Three adapters cover them all: Gemini and Anthropic
 * through their own SDKs, everything else through the OpenAI-compatible chat/completions API.
 *
 * Model ids here are defaults only: a key's own primaryModel / liteModel win, and "Discover models"
 * (the provider's model list) corrects ids that a provider renamed.
 */

export type AdapterId = 'gemini' | 'anthropic' | 'openai'

/** native = the provider enforces a JSON schema; json_object = JSON mode, schema in the prompt; prompt = schema in the prompt only. */
export type JsonMode = 'native' | 'json_object' | 'prompt'

export interface ProviderCapabilities {
  jsonSchema: JsonMode
  vision: boolean
  webSearch: boolean
}

export interface ProviderDef {
  id: string
  label: string
  adapter: AdapterId
  /** API root: Gemini = host only, Anthropic = host only, OpenAI-compatible = up to /v1 (chat/completions is appended). */
  baseUrl: string
  /** Where to create a key. */
  keysUrl?: string
  docsUrl?: string
  /** Formats that identify this provider's keys for sure. */
  keyPatterns: RegExp[]
  /** Environment variable names that hold this provider's key (the importer reads these). */
  envNames: string[]
  defaultPrimary: string
  defaultLite: string
  capabilities: ProviderCapabilities
  /**
   * Free-tier requests per day per model (`default` for unknown models). Absent = no free tier:
   * the key is capped by its dailyCallCap (or the app-wide default) instead.
   */
  freeDaily?: Record<string, number>
  /** Time zone in which the provider's daily quota resets. */
  quotaTz: 'America/Los_Angeles' | 'UTC'
  /** The base URL must be entered (custom endpoints). */
  needsBaseUrl?: boolean
  /** No key needed (local servers). */
  keyOptional?: boolean
  keyPlaceholder: string
}

const GEMINI_FREE: Record<string, number> = {
  default: 20,
  'gemini-3.8-flash': 20,
  'gemini-3.7-flash': 20,
  'gemini-3.6-flash': 20,
  'gemini-3.5-flash': 20,
  'gemini-3-flash-preview': 20,
  'gemini-3.5-flash-lite': 1000,
  'gemini-3.1-flash-lite': 1000,
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    adapter: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    keysUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyPatterns: [/^AIza[\w-]{30,}$/, /^AQ\.[\w.-]{20,}$/],
    envNames: ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'GOOGLE_AI_API_KEY'],
    defaultPrimary: 'gemini-3.8-flash',
    defaultLite: 'gemini-3.5-flash-lite',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: true },
    freeDaily: GEMINI_FREE,
    quotaTz: 'America/Los_Angeles',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.anthropic.com',
    keyPatterns: [/^sk-ant-api\d{2}-[\w-]{20,}$/],
    envNames: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_KEY'],
    defaultPrimary: 'claude-opus-5-5',
    defaultLite: 'claude-haiku-5-5',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: true },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-ant-api03-...',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT / Codex)',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs',
    keyPatterns: [/^sk-(proj|svcacct|admin)-[\w-]{20,}$/],
    envNames: ['OPENAI_API_KEY', 'OPENAI_KEY', 'CODEX_API_KEY'],
    defaultPrimary: 'gpt-5',
    defaultLite: 'gpt-5-mini',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-proj-...',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    adapter: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com',
    keyPatterns: [],
    envNames: ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY'],
    defaultPrimary: 'deepseek-chat',
    defaultLite: 'deepseek-chat',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    adapter: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    keysUrl: 'https://platform.moonshot.ai/console/api-keys',
    docsUrl: 'https://platform.moonshot.ai/docs',
    keyPatterns: [],
    envNames: ['MOONSHOT_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_KEY'],
    defaultPrimary: 'kimi-k2-0905-preview',
    defaultLite: 'moonshot-v1-8k',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'groq',
    label: 'Groq',
    adapter: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keysUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    keyPatterns: [/^gsk_\w{20,}$/],
    envNames: ['GROQ_API_KEY', 'GROQ_KEY'],
    defaultPrimary: 'llama-3.3-70b-versatile',
    defaultLite: 'llama-3.1-8b-instant',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    freeDaily: { default: 1000, 'llama-3.3-70b-versatile': 1000, 'llama-3.1-8b-instant': 14400 },
    quotaTz: 'UTC',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keysUrl: 'https://openrouter.ai/settings/keys',
    docsUrl: 'https://openrouter.ai/docs',
    keyPatterns: [/^sk-or-(v\d-)?[\w-]{20,}$/],
    envNames: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
    defaultPrimary: 'openai/gpt-5',
    defaultLite: 'openai/gpt-5-mini',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: true },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-or-v1-...',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    adapter: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keysUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai',
    keyPatterns: [],
    envNames: ['MISTRAL_API_KEY', 'MISTRAL_KEY'],
    defaultPrimary: 'mistral-large-latest',
    defaultLite: 'mistral-small-latest',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: '32 letters and digits',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    adapter: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keysUrl: 'https://console.x.ai',
    docsUrl: 'https://docs.x.ai',
    keyPatterns: [/^xai-[\w-]{20,}$/],
    envNames: ['XAI_API_KEY', 'GROK_API_KEY', 'XAI_KEY'],
    defaultPrimary: 'grok-4',
    defaultLite: 'grok-3-mini',
    capabilities: { jsonSchema: 'native', vision: true, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'xai-...',
  },
  {
    id: 'together',
    label: 'Together AI',
    adapter: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keysUrl: 'https://api.together.ai/settings/api-keys',
    docsUrl: 'https://docs.together.ai',
    keyPatterns: [/^tgp_v\d_[\w-]{20,}$/],
    envNames: ['TOGETHER_API_KEY', 'TOGETHER_KEY', 'TOGETHERAI_API_KEY'],
    defaultPrimary: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultLite: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'tgp_v1_...',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    adapter: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keysUrl: 'https://fireworks.ai/account/api-keys',
    docsUrl: 'https://docs.fireworks.ai',
    keyPatterns: [/^fw_[\w-]{16,}$/],
    envNames: ['FIREWORKS_API_KEY', 'FIREWORKS_KEY'],
    defaultPrimary: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    defaultLite: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'fw_...',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    adapter: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    keysUrl: 'https://cloud.cerebras.ai',
    docsUrl: 'https://inference-docs.cerebras.ai',
    keyPatterns: [/^csk-[\w-]{20,}$/],
    envNames: ['CEREBRAS_API_KEY', 'CEREBRAS_KEY'],
    defaultPrimary: 'llama-3.3-70b',
    defaultLite: 'llama3.1-8b',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    freeDaily: { default: 14400 },
    quotaTz: 'UTC',
    keyPlaceholder: 'csk-...',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    adapter: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    keysUrl: 'https://www.perplexity.ai/settings/api',
    docsUrl: 'https://docs.perplexity.ai',
    keyPatterns: [/^pplx-[\w-]{20,}$/],
    envNames: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY', 'PERPLEXITY_KEY'],
    defaultPrimary: 'sonar-pro',
    defaultLite: 'sonar',
    // Sonar models always search the web.
    capabilities: { jsonSchema: 'native', vision: false, webSearch: true },
    quotaTz: 'UTC',
    keyPlaceholder: 'pplx-...',
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen (DashScope)',
    adapter: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keysUrl: 'https://modelstudio.console.alibabacloud.com',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio',
    keyPatterns: [],
    envNames: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY', 'ALIBABA_API_KEY'],
    defaultPrimary: 'qwen-plus',
    defaultLite: 'qwen-turbo',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'zhipu',
    label: 'Zhipu GLM (Z.ai)',
    adapter: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    keysUrl: 'https://z.ai/manage-apikey/apikey-list',
    docsUrl: 'https://docs.z.ai',
    // id.secret
    keyPatterns: [/^[a-f0-9]{32}\.[A-Za-z0-9]{16}$/],
    envNames: ['ZHIPU_API_KEY', 'GLM_API_KEY', 'ZHIPUAI_API_KEY', 'ZAI_API_KEY'],
    defaultPrimary: 'glm-4.6',
    defaultLite: 'glm-4.5-flash',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyPlaceholder: 'id.secret',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    adapter: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://ollama.com',
    keyPatterns: [],
    envNames: ['OLLAMA_API_KEY'],
    defaultPrimary: 'llama3.1',
    defaultLite: 'llama3.1',
    capabilities: { jsonSchema: 'json_object', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyOptional: true,
    keyPlaceholder: 'no key needed',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    adapter: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    docsUrl: 'https://lmstudio.ai/docs',
    keyPatterns: [],
    envNames: ['LMSTUDIO_API_KEY'],
    defaultPrimary: '',
    defaultLite: '',
    capabilities: { jsonSchema: 'prompt', vision: false, webSearch: false },
    quotaTz: 'UTC',
    keyOptional: true,
    keyPlaceholder: 'no key needed',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    adapter: 'openai',
    baseUrl: '',
    keyPatterns: [],
    envNames: [],
    defaultPrimary: '',
    defaultLite: '',
    capabilities: { jsonSchema: 'prompt', vision: false, webSearch: false },
    quotaTz: 'UTC',
    needsBaseUrl: true,
    keyOptional: true,
    keyPlaceholder: 'the endpoint key (if any)',
  },
]

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]))

export function getProvider(id: string): ProviderDef | undefined {
  return BY_ID.get(id)
}

/** The provider, or the generic custom one for an id the registry does not know (a row from a newer version). */
export function providerOrCustom(id: string): ProviderDef {
  return BY_ID.get(id) ?? BY_ID.get('custom')!
}

export function isProviderId(id: string): boolean {
  return BY_ID.has(id)
}

/** Capabilities of a key: the provider's, with the key's own overrides ({vision, webSearch, json}). */
export function resolveCapabilities(provider: ProviderDef, overrides: unknown): ProviderCapabilities {
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as { vision?: unknown; webSearch?: unknown; json?: unknown; jsonSchema?: unknown }
  const json = o.json ?? o.jsonSchema
  return {
    vision: typeof o.vision === 'boolean' ? o.vision : provider.capabilities.vision,
    webSearch: typeof o.webSearch === 'boolean' ? o.webSearch : provider.capabilities.webSearch,
    jsonSchema: json === 'native' || json === 'json_object' || json === 'prompt' ? json : provider.capabilities.jsonSchema,
  }
}

/** Which provider a model id belongs to, when the name says so (null for ambiguous ids like "meta-llama/..."). */
export function providerOfModel(model: string): string | null {
  const m = model.toLowerCase()
  if (/^(models\/)?(gemini|gemma)/.test(m)) return 'gemini'
  if (/^claude/.test(m)) return 'anthropic'
  if (/^(gpt|o\d|chatgpt|codex|text-embedding)/.test(m)) return 'openai'
  if (/^deepseek/.test(m)) return 'deepseek'
  if (/^(kimi|moonshot)/.test(m)) return 'moonshot'
  if (/^grok/.test(m)) return 'xai'
  if (/^(mistral|codestral|magistral|pixtral|ministral|devstral|open-mistral)/.test(m)) return 'mistral'
  if (/^sonar/.test(m)) return 'perplexity'
  if (/^(qwen|qwq)/.test(m)) return 'qwen'
  if (/^glm/.test(m)) return 'zhipu'
  return null
}

/** Cheap/fast model names: such a model is never used for a primary (writing) task as a fallback. */
export function isLiteModel(model: string): boolean {
  // Word parts only: "gemini" contains "mini" but is not a lite model.
  return /(^|[-_./:])(lite|mini|haiku|nano|instant|small|8b|flash-8b)([-_./:]|$)|turbo$/i.test(model)
}

/** Public shape for the provider dropdown (GET /api/settings/ai-providers). */
export interface ProviderInfo {
  id: string
  label: string
  adapter: AdapterId
  needsBaseUrl: boolean
  keyOptional: boolean
  keyPlaceholder: string
  keysUrl: string | null
  defaultPrimary: string
  defaultLite: string
  vision: boolean
  webSearch: boolean
}

export function providerInfo(p: ProviderDef): ProviderInfo {
  return {
    id: p.id,
    label: p.label,
    adapter: p.adapter,
    needsBaseUrl: Boolean(p.needsBaseUrl),
    keyOptional: Boolean(p.keyOptional),
    keyPlaceholder: p.keyPlaceholder,
    keysUrl: p.keysUrl ?? null,
    defaultPrimary: p.defaultPrimary,
    defaultLite: p.defaultLite,
    vision: p.capabilities.vision,
    webSearch: p.capabilities.webSearch,
  }
}
