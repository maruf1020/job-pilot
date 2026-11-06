import { z } from 'zod'
import { badRequest, notFound, ok, readJson, route } from '@/lib/api/response'
import { deleteServiceCredential, getServiceDef, saveServiceCredential } from '@/lib/keys/service-keys'

const schema = z.object({ values: z.record(z.string(), z.string().max(2000)) })

/** PUT /api/settings/service-keys/:service {values} -> store the credentials (encrypted). */
export const PUT = route(async (req, { params }) => {
  const { service } = await params
  if (!getServiceDef(service)) throw notFound('Service')
  const { values } = await readJson(req, schema)
  try {
    await saveServiceCredential(service, values, 'manual')
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err))
  }
  return ok({ saved: true })
})

/** DELETE /api/settings/service-keys/:service -> remove the stored credentials (.env, when set, applies again). */
export const DELETE = route(async (_req, { params }) => {
  const { service } = await params
  if (!getServiceDef(service)) throw notFound('Service')
  await deleteServiceCredential(service)
  return ok({ deleted: true })
})
