import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth'
import { handleGmailCallback } from '@/lib/email/gmail'
import { env } from '@/lib/env'
import { enqueueApplyBatchTick, enqueueMailDispatch } from '@/lib/queue'

/** GET /api/gmail/callback?code&state → exchange tokens, redirect to Settings → Email. */
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${env.APP_URL.replace(/\/$/, '')}/settings/email?${q}`)
  try {
    await requireUser()
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const expected = req.cookies.get('gmail_oauth_state')?.value
    if (!code) return back(`error=${encodeURIComponent(url.searchParams.get('error') ?? 'No code returned')}`)
    if (!state || !expected || state !== expected) return back('error=Invalid%20OAuth%20state')
    const { email } = await handleGmailCallback(code)
    // Applications that waited for the mailbox go out now, and a running auto-apply batch queues its
    // prepared drafts, instead of both waiting for the next scheduled minute. A queue problem never
    // fails the connection (the schedules pick everything up anyway) and never holds the redirect long.
    await Promise.race([Promise.allSettled([enqueueMailDispatch(), enqueueApplyBatchTick()]), new Promise((r) => setTimeout(r, 5000))])
    const res = back(`connected=${encodeURIComponent(email)}`)
    res.cookies.delete('gmail_oauth_state')
    return res
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`)
  }
}
