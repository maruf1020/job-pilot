import { db } from '@/lib/db'

/**
 * The last 7 days as a small funnel (plan-ui-redesign.md 7.4): jobs found, fit, applied, replied
 * by a person, next steps offered. Activity in the window, not one cohort followed through, so a
 * later step can be larger than the one before it.
 */

export interface FunnelCounts {
  found: number
  fit: number
  applied: number
  replied: number
  nextStep: number
}

export interface FunnelStep {
  key: keyof FunnelCounts
  label: string
  count: number
  /** Share of the step before it, in percent (null for the first step or when the step before is 0). */
  pctOfPrev: number | null
}

const LABELS: Record<keyof FunnelCounts, string> = {
  found: 'Found',
  fit: 'Fit',
  applied: 'Applied',
  replied: 'Replied',
  nextStep: 'Next step',
}

const ORDER: Array<keyof FunnelCounts> = ['found', 'fit', 'applied', 'replied', 'nextStep']

/** Counts to ordered steps with the share of the previous step. Pure, unit-tested. */
export function toFunnel(counts: FunnelCounts): FunnelStep[] {
  return ORDER.map((key, i) => {
    const prev = i > 0 ? counts[ORDER[i - 1]] : 0
    return { key, label: LABELS[key], count: counts[key], pctOfPrev: i > 0 && prev > 0 ? Math.round((counts[key] / prev) * 1000) / 10 : null }
  })
}

/** Reply classes that are a person answering (auto-replies and bounces are not). */
const PERSON_REPLIES = ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO', 'LOCATION_ISSUE', 'REJECTION', 'APPLY_VIA_PORTAL', 'WRONG_RECIPIENT', 'OTHER']
const NEXT_STEPS = ['INTERVIEW_REQUEST', 'POSITIVE', 'NEEDS_INFO']

export async function loadWeekFunnel(threshold: number, now = new Date()): Promise<{ since: string; steps: FunnelStep[] }> {
  const since = new Date(now.getTime() - 7 * 86_400_000)
  const [found, fit, applied, replied, nextStep] = await Promise.all([
    db.job.count({ where: { firstSeenAt: { gte: since } } }),
    db.job.count({ where: { firstSeenAt: { gte: since }, finalScore: { gte: threshold } } }),
    db.application.count({ where: { sentAt: { gte: since } } }),
    db.emailMessage.findMany({ where: { direction: 'INBOUND', receivedAt: { gte: since }, classification: { in: PERSON_REPLIES } }, distinct: ['applicationId'], select: { applicationId: true } }),
    db.emailMessage.findMany({ where: { direction: 'INBOUND', receivedAt: { gte: since }, classification: { in: NEXT_STEPS } }, distinct: ['applicationId'], select: { applicationId: true } }),
  ])
  return { since: since.toISOString(), steps: toFunnel({ found, fit, applied, replied: replied.length, nextStep: nextStep.length }) }
}
