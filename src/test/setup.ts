// Vitest setup: unit tests never touch the network or the DB, but modules that
// import `@/lib/env` validate on load, so provide safe defaults.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-test-secret'
process.env.APP_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef'
