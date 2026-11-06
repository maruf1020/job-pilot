import type { Metadata } from 'next'
import { GeneralForm } from '@/components/settings/general-form'

export const metadata: Metadata = { title: 'Settings' }

export default function GeneralSettingsPage() {
  return <GeneralForm />
}
