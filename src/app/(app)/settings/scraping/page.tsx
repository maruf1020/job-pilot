import type { Metadata } from 'next'
import { ScrapeTargets } from '@/components/settings/scrape-targets'

export const metadata: Metadata = { title: 'Scraping settings' }

export default function ScrapingSettingsPage() {
  return <ScrapeTargets />
}
