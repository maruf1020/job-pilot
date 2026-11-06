import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MailView } from '@/components/mail/mail-view'
import { PageSkeleton } from '@/components/shared/skeletons'

export const metadata: Metadata = { title: 'Mail' }

export default function MailPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MailView />
    </Suspense>
  )
}
