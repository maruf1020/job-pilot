import type { Metadata } from 'next'
import { RunDetail } from '@/components/runs/run-detail'

export const metadata: Metadata = { title: 'Run' }

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RunDetail id={id} />
}
