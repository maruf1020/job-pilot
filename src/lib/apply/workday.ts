import crypto from 'node:crypto'
import type { Page } from 'playwright'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { db } from '@/lib/db'
import { waitForEmailLink } from './email-codes'
import { hostOf } from './match'
import { clickAndFollow, relevantFields, scanPage, settle } from './navigate'
import type { PageScan, ScannedField } from './types'

/**
 * Workday: one candidate account per company site (tenant). The agent signs in with the saved
 * account or creates one (your email + a strong generated password, stored encrypted), opens the
 * verification link from Gmail when asked, and remembers the "My applications" page.
 */

export function isWorkdayUrl(url: string): boolean {
  return /myworkdayjobs\.com|myworkdaysite\.com|\.workday\.com/i.test(url)
}

/** Candidate home that lists your applications: https://<tenant>/<site>/userHome */
export function workdayStatusUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean)
    // /<locale>?/<site>/job/... (locale like en-US is optional)
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '') ? parts[1] : parts[0]
    return site ? `${u.origin}/${site}/userHome` : null
  } catch {
    return null
  }
}

/** 16 characters with upper, lower, digit and symbol (Workday's rules). */
export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^*-_+='
  const pick = (set: string) => set[crypto.randomInt(set.length)]
  const all = upper + lower + digits + symbols
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols), ...Array.from({ length: 12 }, () => pick(all))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export class WorkdayLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkdayLoginError'
  }
}

async function fillKey(page: Page, f: ScannedField, frames: Awaited<ReturnType<typeof scanPage>>['frames'], value: string) {
  const loc = frames[f.frame ?? 0].locator(`[data-jf-key="${f.key}"]`).first()
  await loc.fill(value, { timeout: 8000 })
}

/**
 * A "Sign In" pop-up over the create-account form (Vanguard): the page then shows three password
 * boxes, reads as the create page, and Sign In was pressed four times with the pop-up empty. Fill the pop-up
 * itself and press its own Sign In. False when no such pop-up is open.
 */
export async function signInDialog(page: Page, email: string, password: string): Promise<boolean> {
  const dialog = page.locator('[role="dialog"]').filter({ has: page.locator('input[type="password"]') }).last()
  if (!(await dialog.isVisible().catch(() => false))) return false
  const emailBox = dialog.locator('input[data-automation-id="email"], input[type="email"], input[autocomplete="email"], input[type="text"]').first()
  const pwBox = dialog.locator('input[type="password"]').first()
  await emailBox.fill(email, { timeout: 8000 })
  await pwBox.fill(password, { timeout: 8000 })
  // Workday lays a role="button" "click_filter" over its Sign In button; the role query finds that layer.
  const submit = dialog.getByRole('button', { name: /^sign in$/i }).last()
  await submit.click({ timeout: 8000 }).catch(() => dialog.locator('[data-automation-id="signInSubmitButton"]').first().click({ force: true, timeout: 8000 }))
  return true
}

function isCreatePage(scan: PageScan): boolean {
  const pw = scan.fields.filter((f) => f.kind === 'password' && f.visible)
  return pw.length >= 2 || /create account|verify new password/i.test(scan.textSample.slice(0, 2000))
}

/**
 * Get past the Workday sign-in page. Returns when the application wizard is shown.
 * Throws WorkdayLoginError when a person has to step in.
 */
export async function workdaySignIn(page: Page, email: string, log: (m: string) => void): Promise<void> {
  const host = hostOf(page.url())
  let account = await db.portalAccount.findUnique({ where: { host } })
  const since = new Date()

  for (let round = 0; round < 4; round++) {
    await settle(page, 800)
    const { scan, frames } = await scanPage(page)
    const fields = relevantFields(scan).filter((f) => f.visible)
    const pw = fields.filter((f) => f.kind === 'password')
    if (pw.length === 0) return // signed in (or no login needed)
    const emailField = fields.find((f) => f.kind === 'email' || /e-?mail/i.test(f.label))

    if (isCreatePage(scan)) {
      if (account) {
        // The Sign In pop-up is already open over the create form: sign in there.
        if (await signInDialog(page, account.email, decryptSecret(account.encryptedPassword)).catch(() => false)) {
          log(`signing in to ${host}`)
          await settle(page, 1500)
          const after = (await scanPage(page)).scan
          if (/(incorrect|invalid|wrong|locked|not match|try again)/i.test(after.textSample.slice(0, 2000)) && after.fields.some((f) => f.kind === 'password' && f.visible)) {
            await db.portalAccount.update({ where: { id: account.id }, data: { status: 'failed', lastError: 'Sign-in rejected' } })
            throw new WorkdayLoginError(`Workday rejected the saved sign-in for ${host}. Check the account in Settings → Browser → Accounts.`)
          }
          await db.portalAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date(), status: 'active', lastError: null } })
          continue
        }
        // We already have an account: go to Sign In instead.
        const signIn = scan.buttons.find((b) => /^sign in$/i.test(b.text) || b.kind === 'login')
        if (signIn) {
          await clickAndFollow(page, frames, signIn)
          continue
        }
      }
      const password = account ? decryptSecret(account.encryptedPassword) : generatePassword()
      if (!account) {
        // Saved before submitting, so the password is never lost.
        account = await db.portalAccount.create({ data: { host, email, encryptedPassword: encryptSecret(password), status: 'unverified', statusUrl: workdayStatusUrl(page.url()) } })
        log(`creating a Workday account on ${host} (password saved in Settings → Browser → Accounts)`)
      }
      if (emailField) await fillKey(page, emailField, frames, email)
      for (const f of pw) await fillKey(page, f, frames, password)
      for (const c of fields.filter((f) => f.kind === 'checkbox' && f.value !== 'true')) {
        await frames[c.frame ?? 0].locator(`[data-jf-key="${c.key}"]`).first().check({ force: true, timeout: 5000 }).catch(() => undefined)
      }
      const create = scan.buttons.find((b) => /create account|sign up|register/i.test(b.text) && !b.disabled)
      if (!create) throw new WorkdayLoginError(`Workday create-account page on ${host} has no Create Account button`)
      await clickAndFollow(page, frames, create)
      await settle(page, 1500)
      const after = (await scanPage(page)).scan
      if (/verify|verification|activate|check your email/i.test(after.textSample.slice(0, 2000))) {
        log('Workday wants the email verified; looking for the link in Gmail')
        const link = await waitForEmailLink({ since, host: /myworkday|workday\.com/i, log })
        if (!link) throw new WorkdayLoginError(`Verify the new Workday account on ${host} with the link in your email, then press Retry`)
        const tab = await page.context().newPage()
        await tab.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined)
        await settle(tab, 1500)
        await tab.close().catch(() => undefined)
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
      }
      await db.portalAccount.update({ where: { id: account.id }, data: { status: 'active' } })
      continue
    }

    // Sign-in page.
    if (!account) {
      const create = scan.buttons.find((b) => /create account|sign up|register/i.test(b.text) || b.kind === 'signup')
      if (create) {
        log('no saved Workday account for this site; creating one')
        await clickAndFollow(page, frames, create)
        continue
      }
      throw new WorkdayLoginError(`Workday on ${host} asks you to sign in and there is no saved account. Sign in once in the apply browser, then press Retry.`)
    }
    if (emailField) await fillKey(page, emailField, frames, account.email)
    await fillKey(page, pw[0], frames, decryptSecret(account.encryptedPassword))
    const submit = scan.buttons.find((b) => /^sign in$/i.test(b.text) && !b.disabled) ?? scan.buttons.find((b) => b.kind === 'login' || b.kind === 'submit')
    if (!submit) throw new WorkdayLoginError(`No Sign In button on ${host}`)
    log(`signing in to ${host}`)
    await clickAndFollow(page, frames, submit)
    await settle(page, 1500)
    const after = (await scanPage(page)).scan
    if (after.fields.some((f) => f.kind === 'password' && f.visible) && /(incorrect|invalid|wrong|locked|not match|try again)/i.test(after.textSample.slice(0, 2000))) {
      await db.portalAccount.update({ where: { id: account.id }, data: { status: 'failed', lastError: 'Sign-in rejected' } })
      throw new WorkdayLoginError(`Workday rejected the saved sign-in for ${host}. Check the account in Settings → Browser → Accounts.`)
    }
    await db.portalAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date(), status: 'active', lastError: null } })
  }
  throw new WorkdayLoginError(`Could not get past the Workday sign-in on ${host}`)
}
