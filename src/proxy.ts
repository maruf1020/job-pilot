import { NextResponse, type NextRequest } from 'next/server'

/**
 * Cheap auth gate: redirect to /login when no Auth.js session cookie is present.
 * Real validation happens in the (app) layout via `auth()`; this only keeps
 * unauthenticated visitors from hitting app pages at all.
 */
const PUBLIC_PREFIXES = ['/login', '/setup', '/api/auth', '/api/health', '/_next', '/favicon', '/icon', '/manifest']

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()
  const hasSession = req.cookies.getAll().some((c) => /^(__Secure-)?authjs\.session-token/.test(c.name))
  if (hasSession) return NextResponse.next()
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ success: false, statusCode: 401, message: 'Not signed in', timestamp: new Date().toISOString() }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml)$).*)'],
}
