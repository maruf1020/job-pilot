import type { NextConfig } from 'next'

const securityHeaders = [
  // Browsers only honour HSTS over HTTPS, so this is inert on localhost and active on Amplify.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

const nextConfig: NextConfig = {
  // The e2e build goes to .next-e2e so it never overwrites the .next of a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Runtime data (Chrome profiles, screenshots, logs, backups) is never part of a route; the running
  // apply browser locks files in storage/, which made file tracing fail the build.
  outputFileTracingExcludes: Object.fromEntries(['*', '/*', '/**', '**'].map((k) => [k, ['./storage/**/*', './test-results/**/*', './playwright-report/**/*', './.next-e2e/**/*']])),
  // Native / node-only packages must not be bundled into server chunks.
  serverExternalPackages: ['playwright', 'patchright', 'patchright-core', 'pg-boss', '@node-rs/argon2', 'pdf-parse', 'googleapis', 'imapflow', 'mailparser', 'nodemailer', '@prisma/adapter-pg', 'pg', '@prisma/client'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Inbox became Mail (docs/MAIL_PLAN.md); old links and bookmarks keep working, with their ?tab=.
  async redirects() {
    return [{ source: '/inbox', destination: '/mail', permanent: false }]
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
