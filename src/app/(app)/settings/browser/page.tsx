import type { Metadata } from 'next'
import { AnswerBankCard, BrowserAgentForm, BrowserStatusCard, PortalAccountsCard } from '@/components/settings/browser-settings'

export const metadata: Metadata = { title: 'Browser apply settings' }

export default function BrowserSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <BrowserStatusCard />
      <BrowserAgentForm />
      <AnswerBankCard />
      <PortalAccountsCard />
    </div>
  )
}
