import { adapterFor } from '@/lib/ai/adapters'
import { getProvider, providerOrCustom } from '@/lib/ai/providers'
import { sha256 } from '@/lib/crypto'
import { db } from '@/lib/db'
import { mapLimit } from '@/lib/utils/semaphore'
import { createAiKey, hintOf, keyHashOf, testRawKey } from './ai-keys'
import { detectProvider, parseKeyText, suggestModels, type DetectedBy, type ParsedEntry } from './detect'
import { getServiceDef, saveServiceCredential } from './service-keys'

export { detectProvider, parseKeyText, suggestModels } from './detect'

/**
 * Bulk key import: paste `.env` text, JSON or bare keys (Settings > AI keys > Import, onboarding),
 * or import what the server's environment holds. Detection order: variable name, key format, then a
 * live probe of the candidate providers for formats several providers share. Full secrets never
 * leave the server: previews show the provider, a 4-character hint and the test result.
 */

const PROBE_TIMEOUT_MS = 6_000

export interface PreviewItem {
  ref: string
  kind: 'ai' | 'service'
  provider?: string
  service?: string
  label: string
  keyHint: string
  detectedBy: DetectedBy
  candidates?: string[]
  duplicate: boolean
  test?: { ok: boolean; error?: string }
  suggested?: { primaryModel?: string; liteModel?: string }
}

export interface ImportPreview {
  items: PreviewItem[]
  warnings: string[]
}

interface AiPlan {
  kind: 'ai'
  ref: string
  entry: ParsedEntry
  provider?: string
  candidates?: string[]
  detectedBy: DetectedBy
}

interface ServicePlan {
  kind: 'service'
  ref: string
  service: string
  values: Record<string, string>
  names: string[]
}

type Plan = AiPlan | ServicePlan

/** Stable reference of a parsed AI key: same key, same ref (the commit re-parses the text). A key pasted twice is listed once. */
function aiRef(entry: ParsedEntry): string {
  return `k-${sha256(entry.value).slice(0, 12)}`
}

function where(e: ParsedEntry): string {
  return e.line ? `line ${e.line}${e.name ? ` (${e.name})` : ''}` : e.name || 'an entry'
}

/** Parse and detect (no network). Service fields are grouped into one entry per service. */
export function planImport(text: string): { plans: Plan[]; warnings: string[] } {
  const warnings: string[] = []
  const plans: Plan[] = []
  const services = new Map<string, ServicePlan>()
  const seen = new Set<string>()
  for (const entry of parseKeyText(text)) {
    const d = detectProvider(entry.name, entry.value)
    if (d.kind === 'ignore') continue
    if (d.kind === 'unsupported') {
      warnings.push(`Skipped ${where(entry)}: ${d.reason}.`)
      continue
    }
    if (d.kind === 'service') {
      const s = services.get(d.service) ?? { kind: 'service' as const, ref: `svc-${d.service}`, service: d.service, values: {}, names: [] }
      s.values[d.field] = entry.value
      s.names.push(d.field)
      services.set(d.service, s)
      continue
    }
    const ref = aiRef(entry)
    if (seen.has(ref)) continue
    seen.add(ref)
    if (d.detectedBy === 'unknown') plans.push({ kind: 'ai', ref, entry, candidates: d.candidates, detectedBy: 'unknown' })
    else plans.push({ kind: 'ai', ref, entry, provider: d.provider, detectedBy: d.detectedBy })
  }
  for (const s of services.values()) {
    const def = getServiceDef(s.service)!
    const missing = def.fields.filter((f) => !f.optional && !s.values[f.name]).map((f) => f.name)
    if (missing.length) warnings.push(`${def.label}: ${missing.join(', ')} missing; add ${missing.length === 1 ? 'it' : 'them'} to import this service.`)
    plans.push(s)
  }
  return { plans, warnings }
}

/** Ask each candidate provider's model list whether it knows this key; the first that answers 200 wins. */
export async function probeProvider(value: string, candidates: string[]): Promise<{ provider: string | null; models: string[] }> {
  const results = await Promise.all(
    candidates.map(async (id) => {
      const p = getProvider(id)
      if (!p?.baseUrl) return null
      try {
        // testKey, not a bare model list: some providers list models without checking the key.
        const r = await Promise.race([adapterFor(id).testKey(value, p.baseUrl, id), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS))])
        if (!r.ok) return null
        return { provider: id, models: r.models ?? [] }
      } catch {
        return null
      }
    }),
  )
  const hit = results.find((r) => r !== null)
  return hit ? { provider: hit.provider, models: hit.models } : { provider: null, models: [] }
}

/** Preview the import: detected provider, how, test result, suggested models, duplicates. */
export async function previewImport(text: string): Promise<ImportPreview> {
  const { plans, warnings } = planImport(text)
  const ai = plans.filter((p): p is AiPlan => p.kind === 'ai')
  const hashes = ai.map((p) => keyHashOf(p.provider ?? 'custom', p.entry.value))
  const stored = new Set((await db.aiKey.findMany({ where: { keyHash: { in: hashes } }, select: { keyHash: true } })).map((r) => r.keyHash))
  const storedServices = new Set((await db.serviceKey.findMany({ select: { service: true } })).map((r) => r.service))

  const items = await mapLimit(plans, 4, async (plan): Promise<PreviewItem> => {
    if (plan.kind === 'service') {
      const def = getServiceDef(plan.service)!
      const secret = def.fields.find((f) => f.secret && plan.values[f.name]) ?? def.fields.find((f) => plan.values[f.name])
      return {
        ref: plan.ref,
        kind: 'service',
        service: plan.service,
        label: def.label,
        keyHint: secret ? hintOf(plan.values[secret.name]) : '',
        detectedBy: 'name',
        duplicate: storedServices.has(plan.service),
      }
    }
    const value = plan.entry.value
    const duplicate = stored.has(keyHashOf(plan.provider ?? 'custom', value))
    let provider = plan.provider
    let detectedBy = plan.detectedBy
    let test: { ok: boolean; error?: string } | undefined
    let models: string[] = []
    if (!provider && plan.candidates?.length && !duplicate) {
      const probe = await probeProvider(value, plan.candidates)
      if (probe.provider) {
        provider = probe.provider
        detectedBy = 'probe'
        models = probe.models
        test = { ok: true }
      } else {
        test = { ok: false, error: `None of ${plan.candidates.map((c) => providerOrCustom(c).label).join(', ')} accepted this key` }
      }
    } else if (provider && !duplicate) {
      const r = await testRawKey(provider, value)
      test = { ok: r.ok, ...(r.error ? { error: r.error } : {}) }
      models = r.models ?? []
    }
    return {
      ref: plan.ref,
      kind: 'ai',
      ...(provider ? { provider } : {}),
      label: provider ? `${providerOrCustom(provider).label} ...${hintOf(value)}` : `Key ...${hintOf(value)}`,
      keyHint: hintOf(value),
      detectedBy,
      ...(plan.candidates?.length && !provider ? { candidates: plan.candidates } : {}),
      duplicate,
      ...(test ? { test } : {}),
      ...(provider ? { suggested: suggestModels(provider, models) } : {}),
    }
  })
  return { items, warnings }
}

export interface ImportPick {
  ref: string
  provider?: string
  label?: string
}

/** Store the picked entries (the text is parsed again here; nothing secret travelled through the browser twice). */
export async function commitImport(text: string, picks: ImportPick[]): Promise<{ added: number; skipped: number; errors: string[] }> {
  const { plans } = planImport(text)
  const byRef = new Map(plans.map((p) => [p.ref, p]))
  let added = 0
  let skipped = 0
  const errors: string[] = []
  for (const pick of picks) {
    const plan = byRef.get(pick.ref)
    if (!plan) {
      errors.push(`${pick.ref}: not found in the pasted text`)
      continue
    }
    try {
      if (plan.kind === 'service') {
        await saveServiceCredential(plan.service, plan.values, 'import')
        added++
        continue
      }
      let provider = pick.provider ?? plan.provider
      if (!provider && plan.candidates?.length) provider = (await probeProvider(plan.entry.value, plan.candidates)).provider ?? undefined
      if (!provider) {
        errors.push(`${hintOf(plan.entry.value)}: pick a provider for this key`)
        continue
      }
      if (await db.aiKey.findUnique({ where: { keyHash: keyHashOf(provider, plan.entry.value) }, select: { id: true } })) {
        skipped++
        continue
      }
      await createAiKey({ provider, key: plan.entry.value, label: pick.label, source: 'import' })
      added++
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 409) skipped++
      else errors.push(`${plan.kind === 'service' ? plan.service : hintOf(plan.entry.value)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { added, skipped, errors }
}

/** The server's environment as `.env` text (only variables the importer could use). */
export function envAsText(source: Record<string, string | undefined> = process.env): string {
  return Object.entries(source)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('\n')
}

/**
 * "Import from .env": every AI key and service credential the server's environment holds, by
 * variable name (keys are not live-tested here, so it is quick; Test on each key does that).
 * Duplicates and services already set in the app are skipped. Never runs on its own: a wipe of
 * the owner's data must not bring keys back.
 */
export async function importKeysFromEnv(source: Record<string, string | undefined> = process.env): Promise<{ added: number; skipped: number }> {
  const { plans } = planImport(envAsText(source))
  let added = 0
  let skipped = 0
  const storedServices = new Set((await db.serviceKey.findMany({ select: { service: true } })).map((r) => r.service))
  for (const plan of plans) {
    if (plan.kind === 'service') {
      const def = getServiceDef(plan.service)!
      const complete = def.fields.every((f) => f.optional || plan.values[f.name])
      if (!complete || storedServices.has(plan.service)) {
        skipped++
        continue
      }
      try {
        await saveServiceCredential(plan.service, plan.values, 'import')
        added++
      } catch {
        skipped++
      }
      continue
    }
    // Only keys whose provider the variable name or format proves. The rest are mostly unrelated
    // tokens of the machine (GITHUB_TOKEN, ...), so they are not counted; ambiguous keys need the Import dialog.
    if (!plan.provider) continue
    try {
      await createAiKey({ provider: plan.provider, key: plan.entry.value, source: 'import', skipTest: true })
      added++
    } catch {
      skipped++
    }
  }
  return { added, skipped }
}
