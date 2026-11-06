// Run a page script in one tab of the agents' Chrome (DevTools port 9344 by default), for finishing forms
// the agents left there. Usage:
//   npx tsx scripts/ops/tab.ts <tab-id-prefix|url-part> <script.js>   (the file holds an async function body; `return` a value)
//   npx tsx scripts/ops/tab.ts <tab-id-prefix|url-part> --upload <selector> <file>
import fs from 'node:fs'

async function main() {
  const [which, a, b, c] = process.argv.slice(2)
  const port = Number(process.env.AGENTS_PORT ?? 9344)
  const { chromium } = await import('playwright')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ id: string; url: string; type: string }>
    const t = targets.find((x) => x.type === 'page' && (x.id.toLowerCase().startsWith(which.toLowerCase()) || x.url.includes(which)))
    if (!t) throw new Error(`no tab matches ${which}`)
    const pages = browser.contexts().flatMap((ctx) => ctx.pages())
    let page = null
    for (const p of pages) {
      const s = await p.context().newCDPSession(p)
      const info = (await s.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } }
      await s.detach()
      if (info.targetInfo.targetId === t.id) {
        page = p
        break
      }
    }
    if (!page) throw new Error('tab found but not attachable')
    if (a === '--upload') {
      await page.setInputFiles(b, c)
      console.log('uploaded', c)
      return
    }
    // Real typing for widgets that ignore set values (Workday dates): --type "<css selector>" <nth> <text>
    if (a === '--type') {
      const [, , , , sel, nth, text] = process.argv
      const box = page.locator(sel).nth(Number(nth))
      await box.click()
      // Replace what is there (a value set without typing is not the widget's own value).
      if (process.env.CLEAR !== '0') {
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Delete')
      }
      await page.keyboard.type(text, { delay: 30 })
      await page.keyboard.press('Tab')
      console.log('typed', text, 'into', sel, nth)
      return
    }
    const body = fs.readFileSync(a, 'utf8')
    const out = await page.evaluate(`(async () => { ${body} })()`)
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1))
  } finally {
    // For a CDP browser, close() only disconnects; Chrome and its tabs stay.
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
