import { redirect } from 'next/navigation'
import { currentUser, needsSetup } from '@/lib/auth'
import { AppShell } from '@/components/layout/app-shell'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser()
  if (!user) redirect((await needsSetup()) ? '/setup' : '/login')
  // The onboarding form comes first: nothing in the app works without the person's profile.
  if (!user.onboardedAt) redirect('/onboarding')
  return <AppShell user={{ email: user.email, name: user.name }}>{children}</AppShell>
}
