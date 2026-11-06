/**
 * Knowledge pack CLI (see scripts/knowledge-lib.ts).
 *
 *   npm run knowledge:export            companies, sponsors, boards, site profiles, lessons -> database/knowledge
 *   npm run knowledge:export -- --jobs  also the jobs found so far (large; jobs*.ndjson.gz stay out of git)
 *   npm run knowledge:import            adds whatever is missing from database/knowledge to this database
 *   npm run knowledge:import -- --dir <folder>
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { exportKnowledge, importKnowledge, KNOWLEDGE_DIR } from './knowledge-lib'

if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* env provided by host */
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const dirIdx = rest.indexOf('--dir')
  const dir = dirIdx >= 0 ? rest[dirIdx + 1] : KNOWLEDGE_DIR
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  const log = (m: string) => console.log(`[knowledge] ${m}`)
  try {
    if (cmd === 'export') {
      const counts = await exportKnowledge(db, { dir, jobs: rest.includes('--jobs'), log })
      log(`exported to ${dir}: ${JSON.stringify(counts)}`)
    } else if (cmd === 'import') {
      const added = await importKnowledge(db, { dir, log })
      log(`imported from ${dir}: ${JSON.stringify(added)}`)
    } else {
      console.log('Usage: tsx scripts/knowledge.ts export [--jobs] [--dir <folder>] | import [--dir <folder>]')
      process.exitCode = 2
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
