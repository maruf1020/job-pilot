import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { currentUser, needsSetup } from '@/lib/auth'

/**
 * The onboarding form has its own frame (no app navigation: nothing works before the profile
 * exists). Signed in and not onboarded only.
 */
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const user = await currentUser()
  if (!user) redirect((await needsSetup()) ? '/setup' : '/login')
  if (user.onboardedAt) redirect('/dashboard')
  return <div className="flex min-h-svh flex-1 flex-col bg-background">{children}</div>
}
