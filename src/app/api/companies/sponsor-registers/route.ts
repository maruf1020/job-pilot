import { z } from 'zod'
import { ok, readJson, route } from '@/lib/api/response'
import { applyRegistersToCompanies, importRegisters, REGISTER_COUNTRIES, registerSummary } from '@/lib/sponsors/registers'

/** GET → what is imported per country. */
export const GET = route(async () => ok(await registerSummary()))

const schema = z.object({ countries: z.array(z.enum(REGISTER_COUNTRIES)).min(1).default(['IE', 'GB', 'NL']) })

/**
 * POST → download the official registers, replace the stored rows, then mark every matching
 * company as a known sponsor. Takes up to a minute (the UK CSV is large).
 */
export const POST = route(async (req) => {
  const { countries } = await readJson(req, schema)
  const imported = await importRegisters(countries)
  const applied = await applyRegistersToCompanies()
  const summary = await registerSummary()
  const parts = imported.results.map((r) => `${r.country}: ${r.rows.toLocaleString()} employers`)
  const errs = imported.errors.map((e) => `${e.country} failed: ${e.error}`)
  return ok(
    { imported: imported.results, errors: imported.errors, applied, summary },
    { message: `${parts.join(', ')}${errs.length ? `; ${errs.join('; ')}` : ''}. ${applied.matched} compan${applied.matched === 1 ? 'y' : 'ies'} newly marked as sponsors.` },
  )
})
