import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { AccountSettings } from '@/components/settings/account-settings'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountSettingsPage() {
  // The (app) layout already sent signed-out visitors to /login.
  const user = await requireUser()
  return <AccountSettings name={user.name} email={user.email} />
}
