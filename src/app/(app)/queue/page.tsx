import type { Metadata } from 'next'
import { NeedsYouView } from '@/components/queue/needs-you'

export const metadata: Metadata = { title: 'Needs you' }

export default function NeedsYouPage() {
  return <NeedsYouView />
}
