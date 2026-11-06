import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { BrowserContext, Frame, Locator, Page } from 'playwright'
import { extensionContexts } from '@/lib/browser/chrome'
import { readOpenOptionsInPage, runInFrame } from './inpage'
import { matchOption, normalizeQuestion } from './match'
import type { PlannedAnswer, ScannedField } from './types'

/**
 * Put planned answers into the page the way a person would: type, choose, tick, upload.
 * Every widget kind has a fallback (label click, keyboard) because sites differ a lot.
 */

const ACTION_TIMEOUT = 8000
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (min: number, max: number) => pause(min + Math.random() * (max - min))

/** Browser contexts of the hidden agents browser (registered by the attempt). */
export const hiddenContexts = new WeakSet<BrowserContext>()

let keyboardLock: Promise<unknown> = Promise.resolve()
/** Set while a call holds the lock, so nested calls (a pick that types) do not wait on themselves. */
const holdingLock = new AsyncLocalStorage<true>()

/**
 * Run `fn` with `page` in front, one agent at a time. The hidden browser keeps every agent's tab
 * in one window: keys go to whichever page has focus (parallel typing mixed "MMMddd"), and Chrome
 * draws only the front tab, so clicks in the others waited for a frame that never came (Smartly:
 * every dropdown timed out after 8 s while the text boxes filled).
 */
export function inFrontOf<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  if (!hiddenContexts.has(page.context()) || holdingLock.getStore()) return fn()
  const run = keyboardLock.then(() =>
    holdingLock.run(true, async () => {
      await page.bringToFront().catch(() => undefined)
      return fn()
    }),
  )
  keyboardLock = run.catch(() => undefined)
  return run
}

/** Keystrokes for `loc`, its page in front (see inFrontOf). */
export function withKeyboard<T>(loc: Locator, fn: () => Promise<T>): Promise<T> {
  return inFrontOf(loc.page(), fn)
}

/** Answers that only need a value set; everything else clicks, opens lists or types. */
const SET_ONLY = new Set(['text', 'email', 'tel', 'number', 'url', 'textarea', 'password'])

function byKey(frame: Frame, key: string): Locator {
  return frame.locator(`[data-jf-key="${key}"]`).first()
}

async function scrollTo(loc: Locator) {
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined)
}

/** Options of the open dropdown; `owner` = key of the control that opened it (reads only its own list). */
async function openOptions(frame: Frame, prefix: string, owner?: string): Promise<Array<{ label: string; key: string }>> {
  for (let i = 0; i < 6; i++) {
    const opts = await runInFrame(frame, readOpenOptionsInPage, { prefix, owner }).catch(() => [])
    if (opts.length) return opts
    await pause(250)
  }
  return []
}

/** True when the control says its dropdown is open (aria-expanded on the control itself). */
async function isExpanded(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => el.getAttribute('aria-expanded') === 'true').catch(() => false)
}

/**
 * Close a dropdown: Escape first; Workable ignores Escape, so click the control again (it toggles),
 * and as a last resort blur it and press outside without clicking anything real.
 */
async function closeDropdown(frame: Frame, loc: Locator): Promise<void> {
  await withKeyboard(loc, async () => {
    await loc.press('Escape').catch(() => undefined)
    await frame.page().keyboard.press('Escape').catch(() => undefined)
  })
  if (await isExpanded(loc)) await loc.click({ timeout: 3000 }).catch(() => undefined)
  if (await isExpanded(loc)) {
    await loc
      .evaluate((el) => {
        ;(el as HTMLElement).blur()
        for (const type of ['mousedown', 'mouseup', 'click']) document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      })
      .catch(() => undefined)
  }
  await pause(150)
}

/** Open a dropdown just to read its options (react-select, Workday listbox), then close it again. */
export async function loadChoiceOptions(frame: Frame, field: ScannedField, prefix: string): Promise<string[]> {
  if (field.kind !== 'combobox' && field.kind !== 'listbox') return field.options.map((o) => o.label)
  // "Search" boxes are guessed from the label ("...status for the location of the posting?" is a fixed list):
  // open them too; a real search box shows nothing until you type.
  const loc = byKey(frame, field.key)
  try {
    await scrollTo(loc)
    if (!(await isExpanded(loc))) await loc.click({ timeout: ACTION_TIMEOUT })
    const opts = await openOptions(frame, prefix, field.key)
    await closeDropdown(frame, loc)
    return opts.map((o) => o.label).filter((l) => !/^(no options|no results( found)?|loading\.*|select\.*|(start |begin )?typing.*|type to search.*|search\.*)$/i.test(l))
  } catch {
    return []
  }
}

async function fillText(loc: Locator, value: string): Promise<boolean> {
  await scrollTo(loc)
  try {
    await loc.fill(value, { timeout: ACTION_TIMEOUT })
  } catch {
    await withKeyboard(loc, async () => {
      await loc.click({ timeout: ACTION_TIMEOUT })
      await loc.press('ControlOrMeta+a').catch(() => undefined)
      await loc.pressSequentially(value, { delay: 10, timeout: 60_000 })
    })
  }
  const got = await loc.inputValue().catch(() => value)
  if (normalizeQuestion(got) !== normalizeQuestion(value)) {
    // Masked inputs (phone, dates) reformat the text: type it instead and accept the formatted result.
    await withKeyboard(loc, async () => {
      await loc.click({ timeout: ACTION_TIMEOUT }).catch(() => undefined)
      await loc.press('ControlOrMeta+a').catch(() => undefined)
      await loc.press('Backspace').catch(() => undefined)
      await loc.pressSequentially(value, { delay: 25, timeout: 60_000 }).catch(() => undefined)
    })
  }
  await loc.blur().catch(() => undefined)
  return (await loc.inputValue().catch(() => '')).trim().length > 0
}

const SUGGEST_LABEL_RE = /\b(location|city|town|where (are you|do you) (currently )?(based|live|located))\b/i

/**
 * Location boxes with suggestions (Lever, Google Places): only a picked suggestion counts.
 * Type the city, pick the suggestion that also names the country; plain text as a fallback.
 */
async function fillWithSuggestions(frame: Frame, loc: Locator, value: string, prefix: string): Promise<boolean> {
  const [city, ...rest] = value.split(',').map((s) => s.trim())
  const country = rest.at(-1) ?? ''
  await scrollTo(loc)
  await withKeyboard(loc, async () => {
    await loc.click({ timeout: ACTION_TIMEOUT })
    await loc.fill('').catch(() => undefined)
    await loc.pressSequentially(city, { delay: 40, timeout: 30_000 })
  })
  for (let i = 0; i < 14; i++) {
    await pause(500)
    const opts = await runInFrame(frame, readOpenOptionsInPage, { prefix }).catch(() => [])
    const good = opts.filter((o) => normalizeQuestion(o.label).includes(normalizeQuestion(city)))
    if (good.length) {
      const pick = (country && good.find((o) => normalizeQuestion(o.label).includes(normalizeQuestion(country)))) || good[0]
      await frame.locator(`[data-jf-key="${pick.key}"]`).first().click({ timeout: ACTION_TIMEOUT })
      await pause(300)
      return true
    }
  }
  // No suggestions appeared: leave the full text (some sites accept it).
  await loc.fill(value).catch(() => undefined)
  await loc.blur().catch(() => undefined)
  return (await loc.inputValue().catch(() => '')).trim().length > 0
}

/**
 * Pick the option that matches `wanted`. `within` limits the choice to options naming it
 * (a place search lists "Lisbon, Ohio, United States" before "Lisbon, Portugal"; only the latter will do).
 */
async function pickFromOpenList(frame: Frame, prefix: string, wanted: string, allowFirst: boolean, owner?: string, within?: string): Promise<string | null> {
  let opts = await openOptions(frame, prefix, owner)
  const inside = (o: { label: string }) => !within || normalizeQuestion(o.label).includes(normalizeQuestion(within))
  // Search results arrive in steps: give the right one a moment to show up.
  for (let i = 0; within && !opts.some(inside) && i < 7; i++) {
    await pause(400)
    opts = await openOptions(frame, prefix, owner)
  }
  opts = opts.filter(inside)
  if (!opts.length) return null
  const labels = opts.map((o) => o.label)
  let best = matchOption(wanted, labels)
  // Whole words only: "No" is not "Non-binary" (Version 1's gender box).
  const w = normalizeQuestion(wanted)
  const hasWords = (l: string) => w.length > 0 && ` ${normalizeQuestion(l)} `.includes(` ${w} `)
  if (!best) best = labels.find(hasWords) ?? null
  // The first search result only when it shares a real word with the answer: a list that shows everything
  // for an unknown answer put "I am an Irish Citizen" where "Dublin" was typed.
  const words = w.split(' ').filter((x) => x.length >= 3)
  if (!best && allowFirst && words.some((x) => ` ${normalizeQuestion(labels[0])} `.includes(` ${x} `))) best = labels[0]
  if (!best) return null
  const o = opts.find((x) => x.label === best)!
  const target = frame.locator(`[data-jf-key="${o.key}"]`).first()
  await target.click({ timeout: ACTION_TIMEOUT }).catch(() => target.click({ timeout: 3000, force: true }))
  return best
}

async function fillCombobox(frame: Frame, field: ScannedField, a: PlannedAnswer, prefix: string): Promise<{ ok: boolean; error?: string }> {
  const loc = byKey(frame, field.key)
  await scrollTo(loc)
  // Some comboboxes are plain inputs (react-select), some are buttons/divs that open a list,
  // and read-only inputs are select boxes in disguise (Workable): typing does nothing there.
  const info = await loc.evaluate((el) => ({ input: el.tagName === 'INPUT', readOnly: (el as HTMLInputElement).readOnly === true })).catch(() => ({ input: false, readOnly: false }))
  const typeable = info.input && !info.readOnly
  // A second click would close an open list (Workable toggles).
  if (!(await isExpanded(loc))) await loc.click({ timeout: ACTION_TIMEOUT })
  if (!typeable) {
    // A list with its own search box (SmartRecruiters' phone country code: open, type "Portugal", pick it):
    // the box takes the focus when the list opens, also inside shadow roots.
    await pause(300)
    const searchFocused = await frame
      .evaluate(() => {
        let el = document.activeElement as HTMLElement | null
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement
        return !!el && el.tagName === 'INPUT' && !(el as HTMLInputElement).readOnly && /^(search|text|)$/.test((el as HTMLInputElement).type)
      })
      .catch(() => false)
    if (searchFocused) {
      await withKeyboard(loc, () => frame.page().keyboard.type(a.value.replace(/\s*\(.*$/, '').slice(0, 30), { delay: 40 }))
      await pause(700)
    }
  }
  if (typeable) {
    await withKeyboard(loc, async () => {
      await loc.fill('').catch(() => undefined)
      await loc.pressSequentially(a.value.slice(0, 40), { delay: 30, timeout: 30_000 })
    })
    await pause(700)
  }
  // A city search: take the first suggestion that names the city as soon as the list shows (type the city,
  // choose the first one, do not wait). A list the scanner cannot read gets ArrowDown + Enter, checked.
  if (typeable && /\bcity\b|\btown\b|residence/i.test(field.label)) {
    const city = normalizeQuestion(a.value).split(' ')[0]
    const country = a.within ? normalizeQuestion(a.within) : ''
    for (let i = 0; i < 15; i++) {
      // The first entry naming the city, in its country when there is one ("Lisbon, Lisbon District, Portugal",
      // never "Lisbon, Ohio, United States").
      const opts = await openOptions(frame, prefix, field.key).catch(() => [])
      const named = opts.filter((o) => ` ${normalizeQuestion(o.label)} `.includes(` ${city} `))
      const pick = (country && named.find((o) => normalizeQuestion(o.label).includes(country))) || (!country ? named[0] : undefined)
      if (pick) {
        const target = frame.locator(`[data-jf-key="${pick.key}"]`).first()
        await target.click({ timeout: ACTION_TIMEOUT }).catch(() => target.click({ timeout: 3000, force: true }))
        return { ok: true }
      }
      if (i >= 3 && (await isExpanded(loc))) {
        await withKeyboard(loc, () => loc.press('ArrowDown', { timeout: 3000 })).catch(() => undefined)
        await enterWithoutSubmit(loc).catch(() => undefined)
        await pause(300)
        if (city && ` ${normalizeQuestion(await loc.inputValue().catch(() => ''))} `.includes(` ${city} `)) return { ok: true }
        break
      }
      await pause(200)
    }
  }
  const picked = await pickFromOpenList(frame, prefix, a.value, Boolean(field.asyncOptions), field.key, a.within)
  if (picked) {
    await pause(200)
    // Multi-selects keep their menu open after a pick, covering the next questions (Elastic's "In what countries...").
    if (await isExpanded(loc)) await closeDropdown(frame, loc)
    // Read-only selects show the choice in the input: check it, and pick once more if a sticky bar caught the click.
    // Workday keeps the input empty and shows the pick as a chip in selectedItemList ("Portugal (+351)"):
    // reading only the input called a kept answer "did not stick" (16 forms in 7 days).
    const chipText = () =>
      loc
        .evaluate((el) => {
          let n: HTMLElement | null = el as HTMLElement
          for (let i = 0; n && i < 8; i++, n = n.parentElement) {
            const list = n.querySelector('[data-automation-id="selectedItemList"]')
            if (list) return list.textContent ?? ''
          }
          return ''
        }, undefined, { timeout: 3000 })
        .catch(() => '')
    const shows = async () => {
      const want = normalizeQuestion(picked)
      return normalizeQuestion(await loc.inputValue({ timeout: 3000 }).catch(() => '')).includes(want) || normalizeQuestion(await chipText()).includes(want)
    }
    if (info.readOnly && !(await shows())) {
      if (!(await isExpanded(loc))) await loc.click({ timeout: ACTION_TIMEOUT }).catch(() => undefined)
      await pickFromOpenList(frame, prefix, picked, false, field.key).catch(() => null)
      await pause(200)
      if (!(await shows())) {
        await closeDropdown(frame, loc)
        return { ok: false, error: `"${picked}" did not stick` }
      }
    }
    return { ok: true }
  }
  // The city not in a city search (SmartRecruiters): its "Cannot find your city? Click here to fill in manually"
  // takes the typed city as it is.
  if (typeable && /\bcity\b|\btown\b|residence/i.test(field.label)) {
    const manual = frame.getByText(/cannot find your city|fill (it )?in manually|enter (it )?manually|city (is )?not (in the )?list/i).first()
    if (await manual.isVisible().catch(() => false)) {
      await manual.click({ timeout: 4000 }).catch(() => undefined)
      await pause(500)
      await withKeyboard(loc, async () => {
        await loc.fill('').catch(() => undefined)
        await loc.pressSequentially(a.value.slice(0, 40), { delay: 30, timeout: 10_000 })
      })
      await loc.blur().catch(() => undefined)
      return { ok: true }
    }
  }
  // The city is not in a fixed region list: try the country, then its region ("EMEA"-style entries).
  if (typeable) {
    for (const alt of a.fallbacks ?? []) {
      await withKeyboard(loc, async () => {
        await loc.fill('').catch(() => undefined)
        await loc.pressSequentially(alt.slice(0, 40), { delay: 30, timeout: 10_000 })
      })
      await pause(700)
      if (await pickFromOpenList(frame, prefix, alt, false, field.key)) return { ok: true }
    }
  }
  if (typeable && field.asyncOptions && /school|university|college|institution/i.test(field.label)) {
    // Greenhouse's school list is mostly US universities; its "Other" entry stands in for the rest.
    await withKeyboard(loc, async () => {
      await loc.fill('').catch(() => undefined)
      await loc.pressSequentially('Other', { delay: 30, timeout: 10_000 })
    })
    await pause(700)
    if (await pickFromOpenList(frame, prefix, 'Other', false, field.key)) return { ok: true }
  }
  if (typeable) {
    // Suggestion lists the page hides from us (SmartRecruiters' City, Institution and Title live in a shadow
    // root and only take a picked suggestion): Down highlights the first one, Enter takes it. The list narrows
    // to what was typed, so the pick is kept when it shares a real word with the answer ("University of
    // Lisbon", "Catholic community"); anything else is a guess (Version 1 put "I am an Irish Citizen" where
    // "Dublin" was typed) and is cleared again, leaving the box for you.
    // The suggestions load from the server about 2 s after typing (done by hand on Implement's form: an
    // earlier key press found no list, and the box cleared itself on leaving).
    await pause(2000)
    await withKeyboard(loc, () => loc.press('ArrowDown', { timeout: 3000 })).catch(() => undefined)
    await pause(300)
    await enterWithoutSubmit(loc).catch(() => undefined)
    await pause(300)
    // Places too: Tabled's City took "Othery, England" where another city was typed.
    const got = ` ${normalizeQuestion(await loc.inputValue().catch(() => ''))} `
    const words = normalizeQuestion(a.value).split(' ').filter((w) => w.length >= 3)
    if (words.some((w) => got.includes(` ${w} `))) return { ok: true }
    await withKeyboard(loc, () => loc.fill('')).catch(() => undefined)
    await closeDropdown(frame, loc)
    return { ok: false, error: `no option like "${a.value}"` }
  }
  await closeDropdown(frame, loc)
  return { ok: false, error: `no option like "${a.value}"` }
}

/**
 * Enter in a form field can submit the whole form: Greenhouse then flags every empty field below it
 * and emails a security code. Submits (and the implicit submit-button click) are swallowed during the key press.
 */
async function enterWithoutSubmit(loc: Locator): Promise<void> {
  await loc
    .evaluate(() => {
      const w = window as unknown as { __jfNoSubmit?: () => void }
      w.__jfNoSubmit?.()
      const stop = (e: Event) => {
        const t = e.target as Element | null
        if (e.type === 'submit' || (t instanceof HTMLButtonElement && t.type === 'submit' && t.form) || (t instanceof HTMLInputElement && t.type === 'submit')) {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }
      window.addEventListener('submit', stop, true)
      window.addEventListener('click', stop, true)
      w.__jfNoSubmit = () => {
        window.removeEventListener('submit', stop, true)
        window.removeEventListener('click', stop, true)
        delete w.__jfNoSubmit
      }
    })
    .catch(() => undefined)
  try {
    await withKeyboard(loc, () => loc.press('Enter'))
    await pause(250)
  } finally {
    await loc.evaluate(() => (window as unknown as { __jfNoSubmit?: () => void }).__jfNoSubmit?.()).catch(() => undefined)
  }
}

async function fillListbox(frame: Frame, field: ScannedField, a: PlannedAnswer, prefix: string): Promise<{ ok: boolean; error?: string }> {
  const loc = byKey(frame, field.key)
  await scrollTo(loc)
  if (!(await isExpanded(loc))) await loc.click({ timeout: ACTION_TIMEOUT })
  let picked = await pickFromOpenList(frame, prefix, a.value, false, field.key)
  if (!picked) {
    // A long list that shows only its first entries until you search (SmartRecruiters' phone "Country code"
    // button at SQLI): type into the search box the list focuses, then pick.
    await pause(300)
    const searchFocused = await frame
      .evaluate(() => {
        let el = document.activeElement as HTMLElement | null
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement
        return !!el && el.tagName === 'INPUT' && !(el as HTMLInputElement).readOnly && /^(search|text|)$/.test((el as HTMLInputElement).type)
      })
      .catch(() => false)
    if (searchFocused) {
      await withKeyboard(loc, () => frame.page().keyboard.type(a.value.replace(/\s*\(.*$/, '').slice(0, 30), { delay: 40 }))
      await pause(700)
      picked = await pickFromOpenList(frame, prefix, a.value, false, field.key)
    }
  }
  if (picked) return { ok: true }
  await closeDropdown(frame, loc)
  return { ok: false, error: `no option like "${a.value}"` }
}

/** Checked state, including ARIA widgets whose native input never changes (Workable radios). */
async function isOn(loc: Locator): Promise<boolean | null> {
  return loc
    .evaluate((el) => {
      const wrap = el.closest('[role="radio"], [role="checkbox"], [role="switch"]')
      const aria = wrap ? wrap.getAttribute('aria-checked') : null
      if (aria === 'true') return true
      if (aria === 'false') return false
      return (el as HTMLInputElement).checked === true
    })
    .catch(() => null)
}

/** Wait briefly for the widget to show the wanted state (React re-renders after the click). */
async function reached(loc: Locator, want: boolean): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    if ((await isOn(loc)) === want) return true
    await pause(150)
  }
  return false
}

/**
 * Tick or untick a radio/checkbox like a person would: the ARIA wrapper (Workable's div[role=radio]
 * around a hidden input), the input itself, its label, then Space on the focused widget.
 * The state is checked after every try, so a working try is never undone by the next one.
 */
async function setChoice(frame: Frame, key: string, want: boolean): Promise<boolean> {
  const loc = byKey(frame, key)
  await scrollTo(loc)
  if ((await isOn(loc)) === want) return true
  const wrapper = loc.locator('xpath=ancestor::*[@role="radio" or @role="checkbox" or @role="switch"][1]')
  const hasWrapper = (await wrapper.count().catch(() => 0)) > 0
  const id = await loc.getAttribute('id').catch(() => null)
  const forLabel = id ? frame.locator(`label[for="${id.replace(/"/g, '\\"')}"]`) : null
  const wrapLabel = loc.locator('xpath=ancestor::label[1]')
  const tries: Array<() => Promise<unknown>> = []
  if (hasWrapper) tries.push(() => wrapper.first().click({ timeout: 4000 }))
  tries.push(() => loc.setChecked(want, { timeout: 4000, force: true }))
  if (forLabel && (await forLabel.count().catch(() => 0)) > 0) tries.push(() => forLabel.first().click({ timeout: 4000 }))
  if ((await wrapLabel.count().catch(() => 0)) > 0) tries.push(() => wrapLabel.first().click({ timeout: 4000 }))
  // A see-through wrapper over the form (Teamtailor's formContentWrapper) takes every real click:
  // click the input itself from inside the page.
  tries.push(() => loc.evaluate((el) => (el as HTMLElement).click()))
  tries.push(async () => {
    const target = hasWrapper ? wrapper.first() : loc
    await withKeyboard(target, async () => {
      await target.focus({ timeout: 2000 })
      await target.press('Space', { timeout: 2000 })
    })
  })
  for (const t of tries) {
    await t().catch(() => undefined)
    if (await reached(loc, want)) return true
  }
  return false
}

/** Whether a choice button shows as picked (aria-pressed/checked, an "active"/"selected" class, a ticked input); null when it gives no sign. */
async function buttonSelected(loc: Locator): Promise<boolean | null> {
  await loc.page().waitForTimeout(250)
  return loc
    .evaluate((el) => {
      for (const a of ['aria-pressed', 'aria-checked', 'aria-selected']) {
        const v = el.getAttribute(a)
        if (v === 'true') return true
        if (v === 'false') return false
      }
      const cls = typeof el.className === 'string' ? el.className : ''
      if (/(^|[\s_-])(active|selected|checked|pressed|is-selected|isSelected)([\s_-]|$)/i.test(cls)) return true
      const input = el.querySelector('input[type="radio"], input[type="checkbox"]') as HTMLInputElement | null
      if (input) return input.checked
      // Siblings carry the sign when this one is picked: no sign on any of them means we cannot tell.
      const sibs = Array.from(el.parentElement?.children ?? [])
      return sibs.some((s) => s !== el && /(^|[\s_-])(active|selected|checked|pressed)([\s_-]|$)/i.test(typeof s.className === 'string' ? s.className : '')) ? false : null
    })
    .catch(() => null)
}

async function clickOption(frame: Frame, field: ScannedField, wanted: string): Promise<{ ok: boolean; error?: string }> {
  const labels = field.options.map((o) => o.label)
  const m = matchOption(wanted, labels)
  const opt = field.options.find((o) => o.label === m)
  if (!opt?.key) return { ok: false, error: `no option like "${wanted}"` }
  if (field.kind === 'buttons') {
    const loc = byKey(frame, opt.key)
    await scrollTo(loc)
    // Yes/No buttons toggle: a second click (a repair round) switched Ashby's answer off again (Allica).
    if ((await buttonSelected(loc)) === true) return { ok: true }
    await loc.click({ timeout: ACTION_TIMEOUT })
    if ((await buttonSelected(loc)) === false) {
      // A see-through layer took the click: press it from inside the page.
      await loc.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined)
      if ((await buttonSelected(loc)) === false) return { ok: false, error: `"${opt.label}" did not stay selected` }
    }
    return { ok: true }
  }
  return (await setChoice(frame, opt.key, true)) ? { ok: true } : { ok: false, error: `"${opt.label}" did not stay selected` }
}

/**
 * Whether the upload widget around a file input lists the chosen file: true / false, or null for a
 * plain input with nothing to compare (then setting the input is all a site needs).
 */
async function fileShown(input: Locator, fileName: string): Promise<boolean | null> {
  return input
    .evaluate((el, name) => {
      // A visible plain input takes the file as it is; only hidden inputs behind a custom widget can ignore it.
      const r = el.getBoundingClientRect()
      const st = getComputedStyle(el)
      if (r.width > 1 && r.height > 1 && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') return null
      let p = el.parentElement
      for (let i = 0; p && i < 5; i++, p = p.parentElement) {
        if ((p.textContent ?? '').includes(name)) return true
        // Reached the widget: it has an upload button but does not show the file.
        const buttons = Array.from(p.querySelectorAll('button, [role="button"]'))
        if (buttons.some((b) => /upload|attach|choose|browse|select|replace/i.test(b.textContent ?? ''))) return false
      }
      return null
    }, fileName)
    .catch(() => null)
}

const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

/**
 * Hand a file to an upload from inside the page, for Chrome reached through the Playwright extension
 * (Chrome refuses it local files). Sets it on the input, or with `drop` drops it on the widget around it.
 */
async function setFileInPage(input: Locator, file: string, drop: boolean): Promise<void> {
  const name = basename(file)
  const data = (await readFile(file)).toString('base64')
  const type = FILE_TYPES[extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'
  await input.evaluate(
    (el, f) => {
      const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], f.name, { type: f.type }))
      if (!f.drop) {
        ;(el as HTMLInputElement).files = dt.files
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
      let zone: HTMLElement = el.parentElement ?? (el as HTMLElement)
      while (zone.parentElement && !zone.querySelector('button, [role="button"]')) zone = zone.parentElement
      for (const kind of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(kind, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { data, name, type, drop },
  )
}

/**
 * Whether an uploaded file is still shown before Submit: Ashby can drop the CV when later answers
 * re-render the form. Uploads it once more when it is gone.
 */
export async function fileKept(frame: Frame, field: ScannedField, a: PlannedAnswer, prefix: string): Promise<boolean> {
  if (!a.file) return true
  const name = a.file.split(/[\\/]/).pop() ?? a.file
  if ((await fileShown(byKey(frame, field.key), name)) !== false) return true
  return (await fillField(frame, field, a, prefix)).ok
}

export async function fillField(frame: Frame, field: ScannedField, a: PlannedAnswer, prefix: string): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (field.kind) {
      case 'file': {
        if (!a.file) return { ok: false, error: 'no file' }
        const input = byKey(frame, field.key)
        const name = a.file.split(/[\\/]/).pop() ?? a.file
        if (extensionContexts.has(frame.page().context())) {
          await setFileInPage(input, a.file, false)
          await pause(1500)
          if ((await fileShown(input, name)) !== false) return { ok: true }
          await setFileInPage(input, a.file, true)
          await pause(2500)
          return (await fileShown(input, name)) === false ? { ok: false, error: 'the site did not take the file' } : { ok: true }
        }
        await input.setInputFiles(a.file, { timeout: 20_000 })
        await pause(1500)
        if ((await fileShown(input, name)) !== false) return { ok: true }
        // Some widgets (Ashby) ignore a file set on the input: use their upload button like a person.
        const button = input.locator('xpath=ancestor::*[.//button][1]').locator('button').filter({ hasText: /upload|attach|choose|browse|select|replace/i }).first()
        // Caught here: when the click fails first, an unwatched timeout here crashed the whole worker.
        const chooser = frame.page().waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null)
        await button.click({ timeout: ACTION_TIMEOUT })
        const picked = await chooser
        if (!picked) return { ok: false, error: 'the upload button did not open a file picker' }
        await picked.setFiles(a.file)
        await pause(2500)
        return (await fileShown(input, name)) === false ? { ok: false, error: 'the site did not take the file' } : { ok: true }
      }
      case 'checkbox':
        return { ok: await setChoice(frame, field.key, a.checked ?? /^yes$/i.test(a.value)) }
      case 'checkboxes': {
        const wanted = new Set((a.choices ?? []).map((c) => normalizeQuestion(c)))
        const stuck: string[] = []
        for (const o of field.options) {
          if (!o.key) continue
          const want = wanted.has(normalizeQuestion(o.label))
          if (!(await setChoice(frame, o.key, want))) stuck.push(o.label)
        }
        return stuck.length ? { ok: false, error: `could not set "${stuck.join('", "').slice(0, 120)}"` } : { ok: true }
      }
      case 'radio':
      case 'buttons':
        return await clickOption(frame, field, a.value)
      case 'select': {
        const loc = byKey(frame, field.key)
        await scrollTo(loc)
        const opt = field.options.find((o) => o.label === a.value) ?? field.options.find((o) => o.label === matchOption(a.value, field.options.map((x) => x.label)))
        if (!opt) return { ok: false, error: `no option like "${a.value}"` }
        await loc.selectOption(opt.value ? { value: opt.value } : { label: opt.label }, { timeout: ACTION_TIMEOUT })
        return { ok: true }
      }
      case 'combobox':
        return await fillCombobox(frame, field, a, prefix)
      case 'listbox':
        return await fillListbox(frame, field, a, prefix)
      case 'date': {
        const loc = byKey(frame, field.key)
        await loc.fill(a.value, { timeout: ACTION_TIMEOUT })
        return { ok: true }
      }
      default: {
        if (field.kind === 'text' && SUGGEST_LABEL_RE.test(field.label)) {
          const loc = byKey(frame, field.key)
          const hasList = await loc
            .evaluate((el) => {
              const box = el.closest('li, .field, .form-group, div')
              return Boolean(el.getAttribute('aria-autocomplete') || el.getAttribute('list') || box?.querySelector('[class*="dropdown" i], [class*="suggest" i], [class*="autocomplete" i], [role="listbox"]') || el.className.toString().includes('pac-target'))
            })
            .catch(() => false)
          if (hasList) return { ok: await fillWithSuggestions(frame, loc, a.value, prefix) }
        }
        return { ok: await fillText(byKey(frame, field.key), a.value) }
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : String(err) }
  }
}

export interface FillResult {
  filled: number
  failed: Array<{ label: string; error: string }>
}

export async function applyPlan(
  frames: Frame[],
  fields: ScannedField[],
  answers: PlannedAnswer[],
  log: (m: string) => void,
): Promise<FillResult> {
  const byFieldKey = new Map(fields.map((f) => [f.key, f]))
  const result: FillResult = { filled: 0, failed: [] }
  // Files first (some sites parse the CV and pre-fill the rest), then top to bottom.
  const ordered = [...answers].sort((a, b) => Number(b.kind === 'file') - Number(a.kind === 'file'))
  for (const a of ordered) {
    const f = byFieldKey.get(a.key)
    if (!f) continue
    const frame = frames[f.frame ?? 0] ?? frames[0]
    const fill = () => fillField(frame, f, a, `f${f.frame ?? 0}o`)
    const r = SET_ONLY.has(f.kind) ? await fill() : await inFrontOf(frame.page(), fill)
    if (r.ok) result.filled++
    else {
      result.failed.push({ label: f.label, error: r.error ?? 'did not stick' })
      log(`could not fill "${f.label.slice(0, 80)}": ${r.error ?? 'did not stick'}`)
    }
    await jitter(60, 220)
  }
  return result
}
