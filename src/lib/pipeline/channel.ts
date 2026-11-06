import type { ApplyChannel } from '@/lib/domain'

/**
 * Which way an application goes. Employers on these systems answer cold emails with
 * "please apply through our careers page" (8 of the 14 human replies so far), and the
 * browser agent fills their forms reliably, so their jobs go to the form even when an
 * email address is known. Email stays for everyone else.
 */
export const FORM_FIRST_ATS = ['greenhouse', 'ashby', 'lever', 'workable'] as const

export function isFormFirst(atsType: string | null | undefined): boolean {
  return Boolean(atsType && (FORM_FIRST_ATS as readonly string[]).includes(atsType))
}

export function preferredChannel(job: { contactEmail: string | null; applyChannel: string; atsType?: string | null }): ApplyChannel {
  if (isFormFirst(job.atsType)) return 'ats'
  if (job.contactEmail) return 'email'
  if (job.applyChannel === 'ats') return 'ats'
  return 'portal'
}
