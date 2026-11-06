import type { AdapterId } from '../providers'
import { providerOrCustom } from '../providers'
import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'
import { openAiCompatAdapter } from './openai-compat'
import type { Adapter } from './types'

export const ADAPTERS: Record<AdapterId, Adapter> = {
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  openai: openAiCompatAdapter,
}

export function adapterFor(providerId: string): Adapter {
  return ADAPTERS[providerOrCustom(providerId).adapter]
}

export type { Adapter, AdapterCall, AdapterResult, ClassifiedError, ErrorKind, KeyTestResult } from './types'
