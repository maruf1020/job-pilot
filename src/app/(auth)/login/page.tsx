import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser, needsSetup } from '@/lib/auth'
import { isGmailConfigured } from '@/lib/env'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'Log in' }

const OAUTH_ERRORS: Record<string, string> = {
  AccessDenied: 'That Google account is not allowed to log in here. Its email must match the account email set in Settings > Account.',
  OAuthAccountNotLinked: 'That Google account is not linked to this account.',
  Configuration: 'Google sign-in is not configured correctly on the server.',
}

const NOTES: Record<string, string> = {
  created: 'Account created. Log in with your name and password.',
  password: 'Password changed. Log in again.',
  removed: 'Your data was removed.',
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; created?: string; password?: string; removed?: string }> }) {
  // currentUser() checks the database, so a cookie from a removed account does not count as signed in.
  if (await currentUser()) redirect('/dashboard')
  if (await needsSetup()) redirect('/setup')
  const sp = await searchParams
  const oauthError = sp.error ? (OAUTH_ERRORS[sp.error] ?? 'Google sign-in failed. Try again or use your password.') : null
  const note = sp.created ? NOTES.created : sp.password ? NOTES.password : sp.removed ? NOTES.removed : null
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-background px-4 py-10">
      <LoginForm googleEnabled={isGmailConfigured} oauthError={oauthError} next={sp.next ?? ''} note={note} />
    </main>
  )
}
