/**
 * Render public/logo.svg to the PNG sizes the app needs (Apple touch icon, PWA icons,
 * a maskable variant with safe-zone padding). Usage: npx tsx scripts/render-icons.ts
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

async function main() {
  const { chromium } = await import('playwright')
  const svg = readFileSync('public/logo.svg', 'utf8')
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  mkdirSync('public/icons', { recursive: true })
  const targets: Array<{ file: string; size: number; pad?: number; bg?: string }> = [
    { file: 'src/app/apple-icon.png', size: 180 },
    { file: 'src/app/icon.png', size: 48 },
    { file: 'public/icons/icon-192.png', size: 192 },
    { file: 'public/icons/icon-512.png', size: 512 },
    // Maskable icons keep the mark inside the central 80% safe zone on a solid background.
    { file: 'public/icons/maskable-512.png', size: 512, pad: 0.1, bg: '#2563eb' },
    { file: 'public/logo-256.png', size: 256 },
  ]
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const t of targets) {
    const inner = Math.round(t.size * (1 - 2 * (t.pad ?? 0)))
    const offset = Math.round((t.size - inner) / 2)
    await page.setViewportSize({ width: t.size, height: t.size })
    await page.setContent(
      `<html><body style="margin:0;width:${t.size}px;height:${t.size}px;background:${t.bg ?? 'transparent'};overflow:hidden">
         <img src="${data}" style="position:absolute;left:${offset}px;top:${offset}px;width:${inner}px;height:${inner}px"/>
       </body></html>`,
    )
    await page.screenshot({ path: join(process.cwd(), t.file), omitBackground: !t.bg, clip: { x: 0, y: 0, width: t.size, height: t.size } })
    console.log(`${t.file} ${t.size}x${t.size}`)
  }
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

export {}
