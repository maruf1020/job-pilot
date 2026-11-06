import { db } from '@/lib/db'
import type { ProfileForPrompt } from '@/lib/ai/prompts'
import { buildCandidateContext } from '@/lib/candidate/context'

export class ProfileMissingError extends Error {
  status = 409
  constructor() {
    super('No candidate profile yet. Finish the onboarding form (or Settings → Profile) first.')
    this.name = 'ProfileMissingError'
  }
}

export async function getProfile() {
  return db.candidateProfile.findUnique({ where: { id: 1 } })
}

export async function getProfileForPrompt(): Promise<ProfileForPrompt> {
  const [p, settings] = await Promise.all([getProfile(), db.settings.findUnique({ where: { id: 1 }, select: { timezone: true } })])
  if (!p || !p.fullName.trim()) throw new ProfileMissingError()
  return {
    fullName: p.fullName,
    headline: p.headline,
    location: p.location,
    yearsExperience: p.yearsExperience,
    summary: p.summary,
    skills: p.skills,
    facts: p.facts,
    titles: p.titles,
    stopSkills: p.stopSkills,
    experience: Array.isArray(p.experience) ? (p.experience as ProfileForPrompt['experience']) : [],
    mindset: p.mindset,
    salaryExpectation: p.salaryExpectation,
    candidate: buildCandidateContext(p as unknown as Record<string, unknown>, settings?.timezone ?? 'UTC'),
  }
}
