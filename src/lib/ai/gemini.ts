/**
 * Historical import path for the AI entry points (about 33 call sites import from here). The work
 * is provider-neutral now: see generate.ts (router), key-pool.ts (keys of any provider) and
 * adapters/ (Gemini, Anthropic, OpenAI-compatible).
 */
export {
  effectiveJsonMode,
  escapeNewlinesInStrings,
  generateJson,
  generateText,
  GroundingQuotaError,
  NoKeyAvailableError,
  parseModelJson,
  testAi,
  testGemini,
  type GenerateJsonOptions,
  type GenerateOptions,
  type GenerateResult,
  type Usage,
} from './generate'
