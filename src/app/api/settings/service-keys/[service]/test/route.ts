import { notFound, ok, route } from '@/lib/api/response'
import { getServiceDef, testServiceCredential } from '@/lib/keys/service-keys'

/** POST /api/settings/service-keys/:service/test -> {ok, error?} where a cheap test exists (nothing is sent). */
export const POST = route(async (_req, { params }) => {
  const { service } = await params
  if (!getServiceDef(service)) throw notFound('Service')
  const r = await testServiceCredential(service)
  return ok(r, { message: r.ok ? 'Works' : `Test failed: ${r.error ?? 'unknown error'}` })
})
