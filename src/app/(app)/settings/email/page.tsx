import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EmailForm } from '@/components/settings/email-form'
import { GmailCard, OAuthResultToast } from '@/components/settings/gmail-card'

export const metadata: Metadata = { title: 'Email settings' }

export default function EmailSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <OAuthResultToast />
      </Suspense>
      <GmailCard />
      <EmailForm />
    </div>
  )
}
