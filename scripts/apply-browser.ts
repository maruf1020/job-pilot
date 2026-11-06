/**
 * Open the apply browser (Chrome with the app's saved profile and DevTools port).
 *   npm run browser                 open it (or report that it is already open)
 *   npm run browser -- <url>        open it on a page, e.g. a login page
 *
 * Use it to log in to sites once (Workday, Google...) or to install extensions;
 * everything is saved in the profile folder and the agent uses the same browser.
 */
if (!process.env.SKIP_DOTENV) {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* environment provided by the host */
  }
}

async function main() {
  const { getSettings } = await import('@/lib/settings/service')
  const { getBrowserStatus, launchApplyBrowser } = await import('@/lib/browser/chrome')
  const { db } = await import('@/lib/db')
  const cfg = (await getSettings()).portal
  const url = process.argv.slice(2).find((a) => /^https?:\/\//i.test(a)) ?? 'about:blank'
  const r = await launchApplyBrowser(cfg, url)
  const s = await getBrowserStatus(cfg)
  console.log(r.launched ? 'Apply browser opened.' : 'Apply browser was already open.')
  console.log(`  Chrome:   ${s.version ?? '?'} (${s.chromePath ?? 'not found'})`)
  console.log(`  Profile:  ${s.profileDir}`)
  console.log(`  DevTools: http://127.0.0.1:${s.port}  (Chrome DevTools MCP server "apply-browser" attaches here)`)
  console.log(`  Tabs:     ${s.tabs.length}`)
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

export {}
