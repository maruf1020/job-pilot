import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getSettings } from '@/lib/settings/service'
import { resolveChromePath } from './chrome'

/**
 * A separate, ordinary Chrome window for forms whose bot check rejects the controlled browser: Lever's
 * "There was an error verifying your application" (still there after the user solved the puzzle)
 * and Recruitee's "Something went wrong". It starts with its own profile (storage/browser/clean-profile)
 * and no remote-debugging port, so nothing drives it and it shows no "controlled by automated test
 * software" bar. The AI cannot fill it: the user fills it (copying from the AI's tab) and then presses
 * "I submitted it".
 */
export function cleanProfileDir(): string {
  return path.resolve(process.cwd(), 'storage', 'browser', 'clean-profile')
}

export async function openInCleanChrome(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, error: 'This application has no form address to open.' }
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'Only web pages can be opened.' }
  const settings = await getSettings()
  const exe = await resolveChromePath(settings.portal)
  if (!exe) return { ok: false, error: 'No Chrome found. Install Google Chrome or set its path in Settings → Browser.' }
  const profile = cleanProfileDir()
  fs.mkdirSync(profile, { recursive: true })
  // A second call with the same profile adds a tab to the window already open.
  const child = spawn(exe.path, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', u.toString()], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  // Windows keeps a window started by a background program behind the others (it looked like nothing
  // happened): raise it.
  if (process.platform === 'win32') {
    const focus = path.resolve(process.cwd(), 'scripts', 'ops', 'focus-clean-chrome.ps1')
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', focus], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
  return { ok: true }
}
