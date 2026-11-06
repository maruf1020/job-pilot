import { CompanyDetailView } from '@/components/companies/company-detail'

export const metadata = { title: 'Company' }

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CompanyDetailView id={id} />
}
