import type { PooledKey } from './key-pool'
import { isLiteModel, providerOfModel } from './providers'

/**
 * Pure routing decisions: which keys, in which order, with which model, can serve a call.
 * generate.ts walks the list this returns and handles quota, cooldowns and errors.
 */

export type Tier = 'primary' | 'lite'

export interface RouteRequest {
  tier: Tier
  /** A model id the caller asked for by name; honoured only on keys of the provider that serves it. */
  explicitModel?: string
  images: boolean
  webSearch: boolean
}

export interface Candidate {
  key: PooledKey
  model: string
  /** Pictures go along (false = text-only fallback on a key without vision). */
  images: boolean
  /** Web search stays on (false = a key without search; the caller copes without). */
  webSearch: boolean
}

type RouteKey = Pick<PooledKey, 'id' | 'provider' | 'priority' | 'primaryModel' | 'liteModel' | 'models' | 'capabilities'>

export function requestFor(opts: { model?: string; images?: unknown[]; webSearch?: boolean }): RouteRequest {
  const images = Boolean(opts.images?.length)
  const webSearch = Boolean(opts.webSearch)
  if (!opts.model || opts.model === 'primary') return { tier: 'primary', images, webSearch }
  if (opts.model === 'lite') return { tier: 'lite', images, webSearch }
  return { tier: isLiteModel(opts.model) ? 'lite' : 'primary', explicitModel: opts.model, images, webSearch }
}

/** True when `model` belongs to this key's provider (listed for the key, its configured model, or named like it). */
export function keyServesModel(key: RouteKey, model: string): boolean {
  if (key.models.includes(model) || key.primaryModel === model || key.liteModel === model) return true
  return providerOfModel(model) === key.provider
}

/** The models to try on this key, best first: the requested one, then the provider's fallbacks. */
export function modelChain(key: RouteKey, req: RouteRequest, fallbackModels: Record<string, string[]> = {}): string[] {
  const main = req.explicitModel && keyServesModel(key, req.explicitModel) ? req.explicitModel : req.tier === 'lite' ? key.liteModel : key.primaryModel
  const out: string[] = []
  for (const m of [main, ...(fallbackModels[key.provider] ?? [])]) {
    if (!m || out.includes(m)) continue
    // Writing tasks never degrade to a lite model: a weaker draft is worse than a deferred one.
    if (out.length > 0 && req.tier === 'primary' && isLiteModel(m)) continue
    out.push(m)
  }
  return out
}

/**
 * Candidate (key, model) pairs in the order they should be tried:
 * 1. Keys that have every capability the call wants come first; a key without vision gets the
 *    call text-only, a key without search gets it without search (both callers cope).
 * 2. Within that, keys by priority (lower first). Keys of equal priority take turns (`rotate`),
 *    and every key's main model is tried before any key's fallback model, so one exhausted
 *    model spreads over all keys before quality drops.
 * routing 'round_robin' ignores priority (all keys take turns).
 */
export function planCandidates<K extends RouteKey>(
  keys: K[],
  req: RouteRequest,
  opts: { fallbackModels?: Record<string, string[]>; routing?: 'priority' | 'round_robin'; rotate?: number } = {},
): Array<{ key: K; model: string; images: boolean; webSearch: boolean }> {
  const penalty = (k: K) => (req.images && !k.capabilities.vision ? 2 : 0) + (req.webSearch && !k.capabilities.webSearch ? 1 : 0)
  const out: Array<{ key: K; model: string; images: boolean; webSearch: boolean }> = []
  const penalties = [...new Set(keys.map(penalty))].sort((a, b) => a - b)
  for (const pen of penalties) {
    const band = keys.filter((k) => penalty(k) === pen)
    const groups = new Map<number, K[]>()
    for (const k of band) {
      const g = opts.routing === 'round_robin' ? 0 : k.priority
      groups.set(g, [...(groups.get(g) ?? []), k])
    }
    for (const g of [...groups.keys()].sort((a, b) => a - b)) {
      const members = groups.get(g)!
      const start = members.length ? (opts.rotate ?? 0) % members.length : 0
      const rotated = [...members.slice(start), ...members.slice(0, start)]
      const chains = rotated.map((k) => ({ k, chain: modelChain(k, req, opts.fallbackModels) }))
      const depth = Math.max(0, ...chains.map((c) => c.chain.length))
      for (let rank = 0; rank < depth; rank++) {
        for (const { k, chain } of chains) {
          if (rank >= chain.length) continue
          out.push({ key: k, model: chain[rank], images: req.images && k.capabilities.vision, webSearch: req.webSearch && k.capabilities.webSearch })
        }
      }
    }
  }
  return out
}
