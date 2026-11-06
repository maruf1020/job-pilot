import type { Metadata } from 'next'
import { SearchForm } from '@/components/settings/search-form'

export const metadata: Metadata = { title: 'Search settings' }

export default function SearchSettingsPage() {
  return <SearchForm />
}
