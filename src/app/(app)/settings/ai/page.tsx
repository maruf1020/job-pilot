import type { Metadata } from 'next'
import { AiForm } from '@/components/settings/ai-form'
import { AiKeysCard, AiUsageCard } from '@/components/settings/ai-keys'
import { BannedPhrasesCard } from '@/components/settings/banned-phrases'

export const metadata: Metadata = { title: 'AI settings' }

export default function AiSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AiKeysCard />
      <AiUsageCard />
      <AiForm />
      <BannedPhrasesCard />
    </div>
  )
}
