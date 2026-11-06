import { JobDetailView } from '@/components/jobs/job-detail'

export const metadata = { title: 'Job' }

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <JobDetailView id={id} />
}
