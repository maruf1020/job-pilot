import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '@/lib/env'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// On Lambda (Amplify) every warm instance holds its own pool, so keep it tiny and let idle
// connections go quickly; a hosted Postgres (Neon) counts every open connection.
const serverless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV || process.env.VERCEL)

function createClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: serverless ? 3 : 10,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
  })
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

// After `prisma generate` (a new column) a hot reload brings a new PrismaClient class; an instance of
// the old one would reject the new fields until `next dev` restarts, so build a fresh client instead.
// The old pool's idle connections close by themselves.
const cached = globalForPrisma.prisma instanceof PrismaClient ? globalForPrisma.prisma : undefined
export const db: PrismaClient = cached ?? createClient()

// Reuse across hot reloads (dev) and warm invocations (serverless).
globalForPrisma.prisma = db

export type Db = typeof db
