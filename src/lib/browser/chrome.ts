import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright'
import type { PortalConfig } from '@/lib/settings/schema'

/**
 * The apply browser: a real Chrome with its own saved profile (logins, cookies, extensions)
 * and a DevTools port on 127.0.0.1. The worker starts it when needed and drives it over CDP;
 * you can watch it and take over in the same window, and Chrome DevTools MCP can attach to it.
 *
 * Playwright is imported lazily so the web bundle never includes it.
 */

type PlaywrightModule = typeof import('playwright')
let playwrightModule: PlaywrightModule | null = null
/**
 * patchright (the same API as Playwright) by default: Playwright's DevTools traffic is detectable, and
 * Cloudflare's check failed on every Personio, Workable and Rippling form, even when one was filled by
 * hand. On the same Personio form patchright passed and Playwright did not.
 * BROWSER_LIB=playwright switches back.
 */
export const BROWSER_LIB = process.env.BROWSER_LIB === 'playwright' ? 'playwright' : 'patchright'
async function pw(): Promise<PlaywrightModule> {
  if (!playwrightModule) playwrightModule = (BROWSER_LIB === 'patchright' ? await import('patchright') : await import('playwright')) as unknown as PlaywrightModule
  return playwrightModule
}

export interface ChromeExecutable {
  path: string
  kind: 'chrome' | 'chromium' | 'custom'
}

function chromeCandidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((r): r is string => Boolean(r))
    return roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
}

/** Google Chrome (extensions from the Web Store work there), else Playwright's Chromium. */
export async function resolveChromePath(cfg: Pick<PortalConfig, 'browserPath'>): Promise<ChromeExecutable | null> {
  const custom = cfg.browserPath.trim() || process.env.APPLY_BROWSER_PATH?.trim()
  if (custom) return fs.existsSync(custom) ? { path: custom, kind: 'custom' } : null
  for (const c of chromeCandidates()) if (fs.existsSync(c)) return { path: c, kind: 'chrome' }
  try {
    const p = (await pw()).chromium.executablePath()
    if (p && fs.existsSync(p)) return { path: p, kind: 'chromium' }
  } catch {
    /* Playwright browsers not installed */
  }
  return null
}

export function resolveProfileDir(cfg: Pick<PortalConfig, 'profileDir'>): string {
  const dir = process.env.APPLY_BROWSER_PROFILE_DIR?.trim() || cfg.profileDir
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
}

export function resolvePort(cfg: Pick<PortalConfig, 'debugPort'>): number {
  const env = Number(process.env.APPLY_BROWSER_PORT)
  return Number.isInteger(env) && env > 1023 ? env : cfg.debugPort
}

/** Browser settings plus the hidden mode the parallel agents use. */
export type BrowserConfig = PortalConfig & { headless?: boolean; keepTabsAwake?: boolean }

/**
 * The browser the parallel agents fill forms in: its own profile and port, never your Chrome. Shown as
 * its own window when Settings → Browser says so (fewer CAPTCHAs than headless), hidden otherwise; either
 * way background tabs are kept awake so several forms render at once.
 */
export function agentsBrowserConfig(cfg: PortalConfig): BrowserConfig {
  return { ...cfg, useMyChrome: false, headless: !cfg.agentsWindow, keepTabsAwake: true, profileDir: `${resolveProfileDir(cfg)}-agents`, debugPort: resolvePort(cfg) + 1 }
}

/** Whether the agent drives your everyday Chrome (setting, or APPLY_BROWSER_USE_MY_CHROME=1). */
export function usesMyChrome(cfg: Pick<PortalConfig, 'useMyChrome'>): boolean {
  return cfg.useMyChrome || process.env.APPLY_BROWSER_USE_MY_CHROME === '1'
}

function defaultChromeUserDataDir(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data')
  if (process.platform === 'darwin') return path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'Google', 'Chrome')
  return path.join(process.env.HOME ?? '', '.config', 'google-chrome')
}

/**
 * The DevTools WebSocket of your everyday Chrome. Chrome writes it to DevToolsActivePort when
 * "Allow remote debugging" is ticked at chrome://inspect/#remote-debugging (Chrome 144+); that
 * server has no HTTP /json endpoints, so the address comes from the file.
 */
export function myChromeEndpoint(): { port: number; ws: string } | null {
  const dir = process.env.MY_CHROME_USER_DATA_DIR?.trim() || defaultChromeUserDataDir()
  try {
    const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)
    if (!/^\d+$/.test(port ?? '') || !wsPath?.startsWith('/devtools/browser/')) return null
    return { port: Number(port), ws: `ws://127.0.0.1:${port}${wsPath.trim()}` }
  } catch {
    return null
  }
}

/** The file outlives Chrome; only a listening port means it is reachable now. */
function portOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

const MY_CHROME_OFF = 'Your Chrome is not reachable. In Chrome open chrome://inspect/#remote-debugging and tick "Allow remote debugging", then try again.'

export interface DevToolsVersion {
  Browser: string
  'User-Agent': string
  webSocketDebuggerUrl: string
}

/** The DevTools endpoint answers when the apply browser is running. */
export async function devToolsVersion(port: number, timeoutMs = 1500): Promise<DevToolsVersion | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return (await res.json()) as DevToolsVersion
  } catch {
    return null
  }
}

interface DevToolsTarget {
  id: string
  type: string
  url: string
  title: string
}

export async function devToolsTabs(port: number): Promise<DevToolsTarget[]> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return []
    return ((await res.json()) as DevToolsTarget[]).filter((t) => t.type === 'page')
  } catch {
    return []
  }
}

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserUnavailableError'
  }
}

/**
 * Start the apply browser if it is not running. Detached, so it outlives the worker and
 * stays open for you; the next run reconnects to it.
 */
export async function launchApplyBrowser(cfg: BrowserConfig, startUrl = 'about:blank'): Promise<{ launched: boolean; version: DevToolsVersion }> {
  // Your own Chrome is never started (or restarted) by the app; callers open a tab in it.
  if (usesMyChrome(cfg)) {
    const mine = myChromeEndpoint()
    if (!mine || !(await portOpen(mine.port))) throw new BrowserUnavailableError(MY_CHROME_OFF)
    return { launched: false, version: { Browser: 'Your Chrome', 'User-Agent': '', webSocketDebuggerUrl: mine.ws } }
  }
  const port = resolvePort(cfg)
  const running = await devToolsVersion(port)
  if (running) return { launched: false, version: running }
  const exe = await resolveChromePath(cfg)
  if (!exe) throw new BrowserUnavailableError('No Chrome found. Install Google Chrome or set the browser path in Settings → Browser.')
  const profileDir = resolveProfileDir(cfg)
  fs.mkdirSync(profileDir, { recursive: true })
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Tests and servers without a screen run it headless (extensions then do not load).
    // A hidden browser starts with a small window; forms and their dropdown menus need a desktop size.
    ...(cfg.headless || process.env.APPLY_BROWSER_HEADLESS === '1' ? ['--headless=new', '--window-size=1440,1000'] : []),
    // Several agents in one window: Chrome would pause every tab but the front one.
    ...(cfg.keepTabsAwake ? ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--window-size=1440,1000'] : []),
    startUrl,
  ]
  const child = spawn(exe.path, args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400))
    const v = await devToolsVersion(port)
    if (v) return { launched: true, version: v }
  }
  throw new BrowserUnavailableError(
    `Chrome did not open its DevTools port ${port}. If another Chrome already uses the profile folder ${profileDir}, close it and try again.`,
  )
}

/** One connection per browser endpoint, shared by every attempt (parallel agents connect once). */
const connections = new Map<string, Promise<Browser>>()
/** Your Chrome's endpoint → when a connection to it last went unanswered (the Allow prompt timed out). */
const refusedAt = new Map<string, number>()
const REFUSED_BACKOFF_MS = 15 * 60_000

const EXTENSION_KEY = 'playwright-extension'

/** Contexts reached through the Playwright extension: Chrome does not let it hand local files to an upload. */
export const extensionContexts = new WeakSet<BrowserContext>()
let extensionFailedAt = 0

/** The Playwright extension is set up (its token in .env) and has not just failed. */
function extensionReady(): boolean {
  return !!process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim() && Date.now() - extensionFailedAt > REFUSED_BACKOFF_MS
}

type ExtensionTools = { tools: { createBrowserWithInfo: (config: unknown, client: { clientName: string }, cli: { profileDirName?: string }) => Promise<{ browser: Browser }> } }

/**
 * Your Chrome through the Playwright extension (Chrome profile PLAYWRIGHT_MCP_PROFILE_DIR_NAME): a local
 * relay the extension connects to with its token, so Chrome never asks "Allow remote debugging?".
 */
async function connectThroughExtension(opts: { reuseOnly?: boolean }): Promise<{ browser: Browser; context: BrowserContext } | null> {
  const cached = connections.get(EXTENSION_KEY)
  if (cached) {
    const browser = await cached.catch(() => null)
    const context = browser?.isConnected() ? browser.contexts()[0] : undefined
    if (browser && context) {
      extensionContexts.add(context)
      return { browser, context }
    }
    if (connections.get(EXTENSION_KEY) === cached) connections.delete(EXTENSION_KEY)
  }
  if (opts.reuseOnly) return null
  const pending = (async () => {
    const { tools } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ 'playwright-core/lib/coreBundle')) as ExtensionTools
    const { browser } = await tools.createBrowserWithInfo(
      { extension: true, browser: { browserName: 'chromium', launchOptions: {}, userDataDir: undefined } },
      { clientName: 'Job Pilot' },
      { profileDirName: process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME?.trim() || undefined },
    )
    browser.on('disconnected', () => {
      if (connections.get(EXTENSION_KEY) === pending) connections.delete(EXTENSION_KEY)
    })
    return browser
  })()
  connections.set(EXTENSION_KEY, pending)
  pending.catch(() => {
    if (connections.get(EXTENSION_KEY) === pending) connections.delete(EXTENSION_KEY)
  })
  const browser = await pending
  const context = browser.contexts()[0]
  if (!context) throw new BrowserUnavailableError('The Playwright extension connected, but there is no Chrome window.')
  extensionContexts.add(context)
  return { browser, context }
}

/**
 * Connect (and launch when needed) to the apply browser; the connection is reused. With
 * "use my Chrome" it attaches to your everyday Chrome and new tabs open in its window:
 * through the Playwright extension when it is set up, else Chrome's remote debugging.
 */
export async function connectApplyBrowser(cfg: BrowserConfig, opts: { launch?: boolean; reuseOnly?: boolean } = {}): Promise<{ browser: Browser; context: BrowserContext }> {
  if (usesMyChrome(cfg) && extensionReady()) {
    const viaExtension = await connectThroughExtension(opts).catch((err: unknown) => {
      extensionFailedAt = Date.now()
      console.warn(`[chrome] Playwright extension did not connect; using remote debugging for now: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
      return null
    })
    if (viaExtension) return viaExtension
  }
  const mine = usesMyChrome(cfg) ? myChromeEndpoint() : null
  if (usesMyChrome(cfg) && (!mine || !(await portOpen(mine.port)))) throw new BrowserUnavailableError(MY_CHROME_OFF)
  const port = resolvePort(cfg)
  const endpoint = mine?.ws ?? `http://127.0.0.1:${port}`
  const cached = connections.get(endpoint)
  if (cached) {
    const browser = await cached.catch(() => null)
    const context = browser?.isConnected() ? browser.contexts()[0] : undefined
    if (browser && context) return { browser, context }
    if (connections.get(endpoint) === cached) connections.delete(endpoint)
  }
  // Background checks never open a connection of their own: your Chrome would ask you to allow it.
  if (opts.reuseOnly) throw new BrowserUnavailableError('Not connected to the browser right now.')
  // Your Chrome asks "Allow remote debugging?" for every new connection: after one went unanswered,
  // do not ask again for a while, or each waiting job pops the prompt up anew.
  const refused = mine ? refusedAt.get(endpoint) : undefined
  if (refused && Date.now() - refused < REFUSED_BACKOFF_MS && !connections.get(endpoint)) {
    const minutes = Math.ceil((REFUSED_BACKOFF_MS - (Date.now() - refused)) / 60_000)
    throw new BrowserUnavailableError(`Your Chrome did not allow the connection; asking again in ${minutes} min.`)
  }
  let pending = connections.get(endpoint)
  if (!pending) {
    pending = (async () => {
      if (!mine && !(await devToolsVersion(port))) {
        if (opts.launch === false) throw new BrowserUnavailableError('The apply browser is not running. Open it from Settings → Browser or run npm run browser.')
        await launchApplyBrowser(cfg)
      }
      // Your Chrome asks you to allow each new connection; leave time to click Allow.
      const browser = await (await pw()).chromium.connectOverCDP(endpoint, { timeout: mine ? 120_000 : 30_000 })
      refusedAt.delete(endpoint)
      browser.on('disconnected', () => {
        if (connections.get(endpoint) === pending) connections.delete(endpoint)
      })
      return browser
    })()
    connections.set(endpoint, pending)
    pending.catch(() => {
      if (mine) refusedAt.set(endpoint, Date.now())
      if (connections.get(endpoint) === pending) connections.delete(endpoint)
    })
  }
  const browser = await pending
  const context = browser.contexts()[0]
  if (!context) throw new BrowserUnavailableError('The apply browser has no window open.')
  return { browser, context }
}

/** Drop the CDP connections without closing Chrome (the window and its tabs stay for you). */
export async function disconnectApplyBrowser(): Promise<void> {
  const all = [...connections.values()]
  connections.clear()
  // For a connectOverCDP browser, close() only disconnects; Chrome keeps running.
  for (const c of all) {
    const browser = await c.catch(() => null)
    if (browser?.isConnected()) await browser.close().catch(() => undefined)
  }
}

/** CDP target id of a tab: stable for the tab's lifetime, used to find it again later. */
export async function tabIdOf(page: Page): Promise<string | null> {
  try {
    const session = await page.context().newCDPSession(page)
    const info = (await session.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } }
    await session.detach().catch(() => undefined)
    return info.targetInfo.targetId
  } catch {
    return null
  }
}

export async function findTab(context: BrowserContext, targetId: string | null | undefined): Promise<Page | null> {
  if (!targetId) return null
  for (const page of context.pages()) {
    if (page.isClosed()) continue
    if ((await tabIdOf(page)) === targetId) return page
  }
  return null
}

export interface BrowserStatus {
  state: 'running' | 'stopped' | 'unavailable'
  port: number
  profileDir: string
  chromePath: string | null
  chromeKind: ChromeExecutable['kind'] | null
  version: string | null
  tabs: Array<{ id: string; url: string; title: string }>
  checkedAt: string
  message?: string
}

/** Cheap probe (HTTP only, no CDP session) used by the worker heartbeat and the API. */
export async function getBrowserStatus(cfg: PortalConfig): Promise<BrowserStatus> {
  if (usesMyChrome(cfg)) {
    const mine = myChromeEndpoint()
    const up = Boolean(mine && (await portOpen(mine.port)))
    return {
      state: up ? 'running' : 'stopped',
      port: mine?.port ?? 0,
      profileDir: 'Your Chrome',
      chromePath: null,
      chromeKind: 'chrome',
      version: up ? 'Your Chrome' : null,
      // Its debugging server has no HTTP tab list; the agent sees tabs once connected.
      tabs: [],
      checkedAt: new Date().toISOString(),
      ...(up ? {} : { message: MY_CHROME_OFF }),
    }
  }
  const port = resolvePort(cfg)
  const profileDir = resolveProfileDir(cfg)
  const exe = await resolveChromePath(cfg)
  const v = await devToolsVersion(port)
  const tabs = v ? (await devToolsTabs(port)).map((t) => ({ id: t.id, url: t.url, title: t.title })) : []
  return {
    state: v ? 'running' : exe ? 'stopped' : 'unavailable',
    port,
    profileDir,
    chromePath: exe?.path ?? null,
    chromeKind: exe?.kind ?? null,
    version: v?.Browser ?? null,
    tabs,
    checkedAt: new Date().toISOString(),
    ...(exe ? {} : { message: 'No Chrome found. Install Google Chrome or set the browser path.' }),
  }
}
