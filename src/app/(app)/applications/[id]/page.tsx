import type { Metadata } from 'next'
import { ApplicationDetail } from '@/components/applications/application-detail'

export const metadata: Metadata = { title: 'Application' }

export default async function ApplicationPage({ params }: PageProps<'/applications/[id]'>) {
  const { id } = await params
  return <ApplicationDetail id={id} />
}
