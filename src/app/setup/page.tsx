import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { needsSetup } from '@/lib/auth'
import { SetupForm } from '@/components/auth/setup-form'

export const metadata: Metadata = { title: 'Create your account' }

/** First run only: once an account exists this page leads to the login. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ removed?: string }> }) {
  if (!(await needsSetup())) redirect('/login')
  const sp = await searchParams
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-background px-4 py-10">
      <SetupForm removed={Boolean(sp.removed)} />
    </main>
  )
}
