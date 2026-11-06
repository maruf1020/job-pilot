import type { Metadata } from 'next'
import { ServiceKeys } from '@/components/settings/service-keys'

export const metadata: Metadata = { title: 'Keys and services' }

export default function KeysSettingsPage() {
  return <ServiceKeys />
}
