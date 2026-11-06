import { defineConfig, env } from 'prisma/config'

// Prisma 7 no longer auto-loads .env; Node 22+ can do it natively. The prod:* scripts
// (scripts/with-env.mjs) provide the environment themselves and set SKIP_DOTENV.
if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile(process.env.PRISMA_ENV_FILE ?? '.env')
  } catch {
    // .env is optional (e.g. CI / Amplify provide DATABASE_URL directly)
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations must use a direct connection (Neon: the URL without "-pooler").
    url: process.env.DIRECT_DATABASE_URL ? env('DIRECT_DATABASE_URL') : env('DATABASE_URL'),
  },
})
