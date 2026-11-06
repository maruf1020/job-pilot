import type { ReactNode } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsTabs } from '@/components/settings/settings-tabs'

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="How jobs are found, ranked, written and sent, and how the browser agent applies." />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <SettingsTabs />
        <div className="w-full min-w-0 max-w-3xl">{children}</div>
      </div>
    </div>
  )
}
