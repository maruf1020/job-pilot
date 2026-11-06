import { z } from 'zod'
import { ATS_TYPES } from '@/lib/domain'

/** Body accepted by POST /api/companies and PATCH /api/companies/[id]. */
export const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).nullable().optional(),
  countryCode: z.string().length(2).nullable().optional(),
  atsType: z.enum(ATS_TYPES).nullable().optional(),
  atsSlug: z.string().trim().max(200).nullable().optional(),
  careersUrl: z.url().nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  knownSponsor: z.boolean().optional(),
  blacklisted: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
})
