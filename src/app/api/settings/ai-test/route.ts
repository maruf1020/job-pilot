import { testAi } from '@/lib/ai/gemini'
import { providerOrCustom } from '@/lib/ai/providers'
import { getAiUsageSummary } from '@/lib/ai/usage'
import { ok, route } from '@/lib/api/response'
import { db } from '@/lib/db'

export const GET = route(async () => ok(await getAiUsageSummary()))

/** POST /api/settings/ai-test -> one tiny call through the router (the first key that can take it). */
export const POST = route(async () => {
  const r = await testAi()
  const key = await db.aiKey.findUnique({ where: { id: r.keyId }, select: { label: true, provider: true } })
  const who = key ? `${key.label} (${providerOrCustom(key.provider).label})` : 'AI'
  return ok(r, { message: r.ok ? `${who} responded in ${r.ms} ms (${r.model})` : `Unexpected reply: ${r.text}` })
})
