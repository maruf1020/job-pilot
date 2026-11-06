import type { Metadata } from 'next'
import { RankingForm } from '@/components/settings/ranking-form'

export const metadata: Metadata = { title: 'Ranking settings' }

export default function RankingSettingsPage() {
  return <RankingForm />
}
