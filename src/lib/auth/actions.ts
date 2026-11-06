'use server'

import { AuthError } from 'next-auth'
import { redirect, unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { db } from '@/lib/db'
import { normalizeUsername, requireUser, signIn, signOut } from '@/lib/auth'
import { hashPassword, verifyPassword } from './password'

export type AuthFormState = { error?: string; username?: string } | null

/** Only same-origin paths may be used as a post-login destination. */
function safeNext(value: unknown): string {
  const s = typeof value === 'string' ? value : ''
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/api/') ? s : '/dashboard'
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!username || !password) return { error: 'Enter your name and password', username }

  try {
    await signIn('credentials', { username, password, redirectTo: safeNext(formData.get('next')) })
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof AuthError) return { error: 'Incorrect name or password (5 wrong tries lock the account for 30 minutes)', username }
    throw error
  }
  return null
}

/** "Continue with Google": only the owner whose account email matches gets in (checked in the signIn callback). */
export async function googleLoginAction(formData: FormData): Promise<void> {
  await signIn('google', { redirectTo: safeNext(formData.get('next')) })
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

// ---------------------------------------------------------------------------
// First run: create the owner account
// ---------------------------------------------------------------------------

export type SetupFormState = { error?: string; name?: string } | null

const PASSWORD_MIN = 10

const setupSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters for the name').max(80, 'Use at most 80 characters'),
    password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters for the password`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'The two passwords are not the same', path: ['confirm'] })

/**
 * Creates the one account of this install. Allowed only while no account exists; afterwards the
 * owner is signed out and sent to the login page to sign in with the new name and password.
 */
export async function setupAction(_prev: SetupFormState, formData: FormData): Promise<SetupFormState> {
  const name = String(formData.get('name') ?? '')
  const parsed = setupSchema.safeParse({ name: formData.get('name'), password: formData.get('password'), confirm: formData.get('confirm') })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form', name }
  const passwordHash = await hashPassword(parsed.data.password)
  const created = await db.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return false
    await tx.user.create({ data: { username: normalizeUsername(parsed.data.name), name: parsed.data.name.trim().replace(/\s+/g, ' '), passwordHash } })
    return true
  })
  if (!created) return { error: 'This install already has an account. Log in instead.', name }
  // Start clean: a cookie from an earlier account on this install must not carry over.
  try {
    await signOut({ redirect: false })
  } catch {
    // no session to end
  }
  redirect('/login?created=1')
}

// ---------------------------------------------------------------------------
// Account settings
// ---------------------------------------------------------------------------

export type AccountFormState = { error?: string; ok?: string } | null

const renameSchema = z.object({ name: z.string().trim().min(2).max(80) })

export async function renameAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser()
  const parsed = renameSchema.safeParse({ name: formData.get('name') })
  if (!parsed.success) return { error: 'Use 2 to 80 characters' }
  const username = normalizeUsername(parsed.data.name)
  const clash = await db.user.findFirst({ where: { username, NOT: { id: user.id } }, select: { id: true } })
  if (clash) return { error: 'That name is taken' }
  await db.user.update({ where: { id: user.id }, data: { username, name: parsed.data.name.trim().replace(/\s+/g, ' ') } })
  return { ok: 'Saved. Log in with the new name next time.' }
}

const emailSchema = z.object({ email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email())]) })

/** Optional account email (Google sign-in, digest emails). */
export async function accountEmailAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser()
  const parsed = emailSchema.safeParse({ email: formData.get('email') ?? '' })
  if (!parsed.success) return { error: 'That is not an email address' }
  const email = parsed.data.email || null
  if (email) {
    const clash = await db.user.findFirst({ where: { email, NOT: { id: user.id } }, select: { id: true } })
    if (clash) return { error: 'That email belongs to another account' }
  }
  await db.user.update({ where: { id: user.id }, data: { email } })
  return { ok: 'Saved.' }
}

const passwordSchema = z
  .object({ current: z.string().min(1), password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(200), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The two new passwords are not the same', path: ['confirm'] })

/** Changes the password and ends every session (all devices log in again). */
export async function changePasswordAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const user = await requireUser()
  const parsed = passwordSchema.safeParse({ current: formData.get('current'), password: formData.get('password'), confirm: formData.get('confirm') })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? `Use at least ${PASSWORD_MIN} characters` }
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!(await verifyPassword(row.passwordHash, parsed.data.current))) return { error: 'The current password is not right' }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password), sessionVersion: { increment: 1 } } })
  await signOut({ redirectTo: '/login?password=1' })
  return null
}
