import { z } from 'zod'

/** Body accepted by POST /api/scrape-targets and PATCH /api/scrape-targets/[id]. */
export const scrapeTargetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.url(),
  enabled: z.boolean().default(true),
  linkSelector: z.string().trim().max(300).nullable().optional(),
  linkPattern: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .refine((v) => {
      if (!v) return true
      try {
        new RegExp(v)
        return true
      } catch {
        return false
      }
    }, 'Invalid regular expression'),
  maxLinks: z.number().int().min(1).max(200).default(30),
  maxPages: z.number().int().min(1).max(20).default(1),
  requireEmail: z.boolean().default(true),
  countryCode: z.string().length(2).nullable().optional(),
  waitMs: z.number().int().min(0).max(15000).default(1500),
  notes: z.string().max(2000).nullable().optional(),
})
