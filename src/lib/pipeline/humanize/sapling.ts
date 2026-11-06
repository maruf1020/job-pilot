import { getServiceCredential } from '@/lib/keys/service-keys'

/**
 * Optional external AI-text detector (Sapling). Free tier covers short texts.
 * Returns a 0..1 "probability AI" score, or null when disabled/unavailable.
 */
export async function saplingScore(text: string): Promise<number | null> {
  const key = (await getServiceCredential('sapling'))?.SAPLING_KEY
  if (!key) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch('https://api.sapling.ai/api/v1/aidetect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, text: text.slice(0, 2000) }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { score?: number }
    return typeof data.score === 'number' ? data.score : null
  } catch {
    return null
  }
}
