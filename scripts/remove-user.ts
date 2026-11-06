/**
 * Removes the owner's data from this install and keeps the shared knowledge (the same as Settings
 * > Account > Remove my data). For handing a database or a server to someone else.
 *
 *   npm run data:remove-user -- --yes            database + personal files under storage/
 *   npm run data:remove-user -- --yes --db-only  database only
 *   npm run data:remove-user -- --yes --export my-data.json   save a JSON copy first
 *
 * Stop the workers first (they would otherwise keep a browser profile open).
 */
import { writeFileSync } from 'node:fs'

if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* env provided by host */
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.includes('--yes')) {
    console.log('This deletes the account, profile, CVs, applications, emails, answers, logins and keys of this install.')
    console.log('Companies, jobs (unscored), job boards, sponsor lists and site lessons are kept.')
    console.log('Run again with --yes to do it (add --export <file.json> to save a copy first, --db-only to keep files).')
    process.exitCode = 2
    return
  }
  const { exportOwnerData, removeOwnerData } = await import('../src/lib/account/remove')
  const exportIdx = args.indexOf('--export')
  if (exportIdx >= 0 && args[exportIdx + 1]) {
    writeFileSync(args[exportIdx + 1], JSON.stringify(await exportOwnerData(), null, 2))
    console.log(`saved a copy to ${args[exportIdx + 1]}`)
  }
  const report = await removeOwnerData({ files: !args.includes('--db-only') })
  console.log('deleted:', report.deleted)
  console.log('reset:', report.reset)
  console.log('files removed:', report.files.length ? report.files.join(', ') : 'none')
  console.log('kept:', report.kept)
  console.log('Done. The next visit to the app starts at /setup.')
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
