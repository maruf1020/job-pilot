import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { OnboardingWizard } from '@/components/onboarding/wizard'

export const metadata: Metadata = { title: 'Set up your profile' }

export default async function OnboardingPage() {
  // The layout already checked the session; this gives the name for the greeting.
  const user = await requireUser()
  return (
    // The wizard reads ?step= with useSearchParams, which wants a Suspense boundary above it.
    <Suspense fallback={null}>
      <OnboardingWizard accountName={user.name} />
    </Suspense>
  )
}
