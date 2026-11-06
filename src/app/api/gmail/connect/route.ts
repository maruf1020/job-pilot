import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { errorToResponse } from '@/lib/api/response'
import { requireUser } from '@/lib/auth'
import { getGmailAuthUrl } from '@/lib/email/gmail'

/** GET /api/gmail/connect → redirect to Google's consent screen. */
export async function GET() {
  try {
    await requireUser()
    const state = randomBytes(16).toString('hex')
    const res = NextResponse.redirect(getGmailAuthUrl(state))
    res.cookies.set('gmail_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' })
    return res
  } catch (err) {
    return errorToResponse(err)
  }
}
