import { ok, route } from '@/lib/api/response'
import { loadApplyMeasures, loadTodaySample } from '@/lib/analytics/apply-engine'

/** GET /api/dashboard/apply-engine → apply-engine measures and a random sample of the last day's submissions. */
export const GET = route(async () => {
  const [measures, sample] = await Promise.all([loadApplyMeasures(), loadTodaySample()])
  return ok({ measures, sample })
})
