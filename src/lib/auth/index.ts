import NextAuth, { type DefaultSession } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { z } from 'zod'
import { db } from '@/lib/db'
import { env, isGmailConfigured } from '@/lib/env'
import { verifyPassword } from './password'

declare module 'next-auth' {
  interface Session {
    user: { id: string; sv?: number } & DefaultSession['user']
  }
}

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 30

/** Login names are compared lowercase and trimmed; inner spaces are kept ("Alex Rivera" works). */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase()
}

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw)
        if (!parsed.success) return null
        const username = normalizeUsername(parsed.data.username)
        // The account's email works as the login name too.
        const user = await db.user.findFirst({ where: { OR: [{ username }, { email: username }] } })
        if (!user) return null
        if (user.lockedUntil && user.lockedUntil > new Date()) return null

        const ok = await verifyPassword(user.passwordHash, parsed.data.password)
        if (!ok) {
          const attempts = user.failedLoginAttempts + 1
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
            },
          })
          return null
        }
        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await db.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
        }
        return { id: user.id, email: user.email, name: user.name }
      },
    }),
    // Optional: "Continue with Google" for the owner whose account email matches (never creates users).
    ...(isGmailConfigured
      ? [
          Google({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            authorization: { params: { prompt: 'select_account' } },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true
      const email = profile?.email?.toLowerCase()
      if (!email || profile?.email_verified === false) return false
      return Boolean(await db.user.findUnique({ where: { email }, select: { id: true } }))
    },
    async jwt({ token, user, account }) {
      if (user) {
        const row =
          account?.provider === 'google' && user.email
            ? await db.user.findUnique({ where: { email: user.email.toLowerCase() }, select: { id: true, sessionVersion: true } })
            : user.id
              ? await db.user.findUnique({ where: { id: user.id }, select: { id: true, sessionVersion: true } })
              : null
        if (row) {
          token.sub = row.id
          token.sv = row.sessionVersion
        }
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (typeof token.sv === 'number') session.user.sv = token.sv
      return session
    },
  },
})

export interface CurrentUser {
  id: string
  username: string
  name: string
  email: string | null
  onboardedAt: Date | null
}

/**
 * The signed-in owner, checked against the database: a session whose user was removed ("Remove my
 * data") or whose password changed (sessionVersion bumped) is not signed in any more.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth()
  const id = session?.user?.id
  if (!id) return null
  const u = await db.user.findUnique({ where: { id }, select: { id: true, username: true, name: true, email: true, onboardedAt: true, sessionVersion: true } })
  if (!u || u.sessionVersion !== (session.user.sv ?? 0)) return null
  return { id: u.id, username: u.username, name: u.name, email: u.email, onboardedAt: u.onboardedAt }
}

/** For server components / actions / route handlers that require a signed-in user. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

/** True while the install has no account yet: every page then leads to /setup. */
export async function needsSetup(): Promise<boolean> {
  return (await db.user.count()) === 0
}

export class UnauthorizedError extends Error {
  status = 401
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}
