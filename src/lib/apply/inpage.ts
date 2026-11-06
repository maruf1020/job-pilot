import type { Frame } from 'playwright'
import type { FrameScan } from './types'

/**
 * Code that runs inside the page. Each function must be self-contained: Playwright sends its
 * source text to the browser, so it may not use imports or anything from this module's scope.
 *
 * tsx (the worker) compiles with keepNames, which inserts `__name(fn, "fn")` calls into the
 * function bodies; `runInFrame` defines a no-op `__name` in the page first so they still run.
 */
export async function runInFrame<A, R>(frame: Frame, fn: (arg: A) => R, arg: A): Promise<R> {
  const source = `(() => { const g = globalThis; if (!g.__name) g.__name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg)}) })()`
  // The page's own world, as with Playwright: patchright runs scripts in an isolated world unless told
  // otherwise, and the panel's chat reaches the app through a binding that lives in the page's world.
  // Playwright itself throws on more than two arguments; patchright's evaluate declares four.
  const evaluate = frame.evaluate as unknown as (expr: string, arg?: undefined, options?: undefined, isolatedContext?: boolean) => Promise<unknown>
  return (await (evaluate.length >= 4 ? evaluate.call(frame, source, undefined, undefined, false) : evaluate.call(frame, source))) as R
}

/**
 * Read every question on the page (including open shadow roots): label, kind, required,
 * options, current value; plus buttons, CAPTCHA state, success and error messages.
 * Elements get a stable `data-jf-key` attribute so the filler can find them again.
 */
export function scanFrameInPage(arg: { prefix: string }): FrameScan {
  type Kind = FrameScan['fields'][number]['kind']
  type Field = FrameScan['fields'][number]
  type Button = FrameScan['buttons'][number]
  const w = window as unknown as { __jfSeq?: number }
  if (!w.__jfSeq) w.__jfSeq = 0

  const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
  const textOf = (el: Element | null | undefined): string => {
    if (!el) return ''
    const h = el as HTMLElement
    return clean(typeof h.innerText === 'string' && h.innerText ? h.innerText : el.textContent)
  }
  const keyOf = (el: Element): string => {
    let k = el.getAttribute('data-jf-key')
    if (!k) {
      w.__jfSeq = (w.__jfSeq ?? 0) + 1
      k = `${arg.prefix}${w.__jfSeq}`
      el.setAttribute('data-jf-key', k)
    }
    return k
  }
  const stripReq = (s: string): string =>
    clean(s.replace(/[*✱]/g, ' ').replace(/\((required|optional)\)/gi, ' ').replace(/\brequired\b\s*$/i, ''))
  const isReqText = (s: string): boolean => /[*✱]|\(required\)/i.test(s)

  // All elements, piercing open shadow roots.
  const all: Element[] = []
  const walk = (root: Document | ShadowRoot | Element) => {
    const list = root.querySelectorAll('*')
    for (const el of Array.from(list)) {
      // Our own panel (the user's instructions box) is never part of the application form.
      if (el.closest('#jf-handover, #jf-pill')) continue
      all.push(el)
      const sr = (el as HTMLElement).shadowRoot
      if (sr) walk(sr)
    }
  }
  walk(document)

  const styleHidden = (el: Element): boolean => {
    const st = getComputedStyle(el)
    return st.display === 'none' || st.visibility === 'hidden'
  }
  const visibleBox = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1 && !styleHidden(el)
  }
  // An open modal form (LinkedIn Easy Apply) is the whole form: the page behind it (search box,
  // language picker) is not part of the application. Cookie dialogs never count.
  {
    const within = (el: Element, root: Element): boolean => {
      let n: Element | null = el
      while (n) {
        if (n === root) return true
        n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)
      }
      return false
    }
    const modal = all.find((el) => {
      const isModal = (el.getAttribute('role') === 'dialog' && el.getAttribute('aria-modal') === 'true') || (el.tagName === 'DIALOG' && (el as HTMLDialogElement).open)
      if (!isModal || !visibleBox(el)) return false
      if (/cookie|consent|onetrust|usercentrics/i.test(`${el.id} ${el.className} ${el.getAttribute('aria-label') ?? ''}`)) return false
      const inside = all.filter((x) => within(x, el))
      const fieldsInside = inside.some((x) => (x.tagName === 'INPUT' && !['hidden', 'checkbox'].includes((x as HTMLInputElement).type)) || x.tagName === 'SELECT' || x.tagName === 'TEXTAREA')
      const flowButton = inside.some((x) => x.tagName === 'BUTTON' && /^(next|review|submit application|continue)\b/i.test((x.textContent ?? '').trim()))
      return fieldsInside || flowButton
    })
    if (modal) {
      const scoped = all.filter((x) => within(x, modal))
      all.length = 0
      all.push(...scoped)
    }
  }
  const inHiddenTree = (el: Element): boolean => {
    let n: Element | null = el
    while (n) {
      if (n.getAttribute('aria-hidden') === 'true' && n !== document.body) return true
      if (styleHidden(n) && n.tagName !== 'INPUT') return true
      n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)
    }
    return false
  }

  const rootQuery = (el: Element, selector: string): Element | null => {
    const root = el.getRootNode() as Document | ShadowRoot
    try {
      return root.querySelector(selector)
    } catch {
      return null
    }
  }

  const labelledBy = (el: Element): string => {
    const ids = el.getAttribute('aria-labelledby')
    if (!ids) return ''
    return clean(
      ids
        .split(/\s+/)
        .map((id) => {
          const root = el.getRootNode() as Document | ShadowRoot
          const t = root.getElementById ? root.getElementById(id) : document.getElementById(id)
          return textOf(t)
        })
        .join(' '),
    )
  }

  /** Nearest label-like text block that comes before `el` inside a small container. */
  const precedingText = (el: Element, maxDepth: number): string => {
    let node: Element | null = el.parentElement
    for (let depth = 0; node && depth < maxDepth; depth++, node = node.parentElement) {
      const cands = Array.from(
        node.querySelectorAll('label, legend, .application-label, [class*="label" i], [class*="question" i], [class*="title" i], h3, h4, h5, p, span, div'),
      )
      for (const c of cands) {
        if (c === el || c.contains(el)) continue
        if (!(c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
        // Only leaf-ish text blocks.
        if (c.children.length > 3) continue
        if (c.querySelector('input, select, textarea, button')) continue
        const t = textOf(c)
        if (t && t.length >= 2 && t.length < 400) return t
      }
    }
    return ''
  }

  /**
   * The text shown just above a box on screen, whatever the markup (SmartRecruiters screening questions:
   * the question sits outside the web component that holds the input, so Version 1's "What is your
   * postcode?" read as "" and got an answer meant for another question).
   */
  const visualLabel = (el: Element): string => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return ''
    let best = ''
    let bestGap = 70
    for (const c of all) {
      if (c === el || c.contains(el) || c.children.length > 3 || /^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION|SCRIPT|STYLE|SVG|PATH)$/i.test(c.tagName)) continue
      if (c.querySelector('input, select, textarea, button')) continue
      const b = c.getBoundingClientRect()
      if (!b.width || !b.height || b.height > 120) continue
      const gap = r.top - b.bottom
      if (gap < -2 || gap >= bestGap || b.right < r.left - 4 || b.left > r.right - 4) continue
      const t = textOf(c)
      if (!t || t.length < 3 || t.length > 400) continue
      best = t
      bestGap = gap
    }
    return best
  }

  /**
   * A button that opens a menu of choices (Teamtailor's "Select an option": aria-haspopup="menu" with
   * menuitemradio entries): one question with options, not a navigation button. Null for other buttons.
   */
  const choiceMenuOf = (el: Element): Element | null => {
    if (el.tagName !== 'BUTTON' || el.getAttribute('aria-haspopup') !== 'menu') return null
    const id = el.getAttribute('aria-controls')
    const root = el.getRootNode() as Document | ShadowRoot
    const menu = id ? (root.getElementById ? root.getElementById(id) : document.getElementById(id)) : null
    return menu?.querySelector('[role="menuitemradio"], [role="menuitemcheckbox"]') ? menu : null
  }

  /**
   * A radio or checkbox the user can see: itself, its wrapping label, or a separate label[for] drawn in its
   * place (Recruitee hides the input under a styled label: Famly's and twipe's yes/no questions were
   * dropped as invisible and never answered).
   */
  const shownChoice = (m: Element): boolean => {
    if (visibleBox(m) || visibleBox(m.closest('label') ?? m)) return true
    const id = m.getAttribute('id')
    const forLabel = id ? rootQuery(m, `label[for="${CSS.escape(id)}"]`) : null
    return !!forLabel && visibleBox(forLabel)
  }

  /** A label that names something: a lone "*" or ":" (SmartRecruiters' empty slot label) is no question. */
  const worded = (t: string | null | undefined): string => (t && /\p{L}{2}/u.test(t) ? t : '')

  /** The nearest ancestor matching `selector`, also across shadow-root boundaries. */
  const composedClosest = (el: Element, selector: string, maxHops = 12): Element | null => {
    let n: Element | null = el
    for (let hop = 0; n && hop < maxHops * 4; hop++) {
      if (n.matches?.(selector)) return n
      n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)
    }
    return null
  }

  /** Text of the question that owns `el`: label, aria, legend, or the nearest label-like text above it. */
  const questionLabel = (el: Element, forGroup = false): string => {
    if (!forGroup) {
      const lb = worded(labelledBy(el))
      if (lb) return lb
      const id = el.getAttribute('id')
      if (id) {
        const l = rootQuery(el, `label[for="${CSS.escape(id)}"]`)
        const lt = worded(textOf(l))
        if (lt) return lt
      }
      const wrap = el.closest('label')
      if (wrap) {
        // A wrapping label may also contain the whole field (Lever); prefer its label-ish child.
        const inner = wrap.querySelector('.application-label, [class*="label" i]')
        const t = worded(textOf(inner)) || worded(textOf(wrap))
        if (t && t.length < 300) return t
      }
      const al = worded(el.getAttribute('aria-label'))
      if (al && clean(al)) return clean(al)
      // SmartRecruiters screening (Tieto, finanzen.net, AJ Bell, Bertelsmann): the input lives in a
      // web component whose own label is just "*"; the question is the host's aria-label ("Select <question>")
      // or the text of the question container around the component, outside its shadow root.
      const host = (el.getRootNode() as ShadowRoot).host
      if (host) {
        const hl = worded(host.getAttribute('label')) || worded(host.getAttribute('aria-label')) || worded(textOf(host.querySelector('[slot*="label" i], label')))
        if (hl) return clean(hl).replace(/^(?:[Ss]elect|[Ee]nter|[Cc]hoose|[Tt]ype)\s+(?=\p{Lu})/u, '')
      }
      const container = composedClosest(el, '[data-test="question-container"], [data-test*="question" i]')
      if (container && container !== el) {
        const raw = (container as HTMLElement).innerText || container.textContent || ''
        const first = clean(raw.split('\n').find((line) => worded(line.trim())) ?? '')
        if (first && first.length < 400) return first
      }
      const near = precedingText(el, 3)
      if (near) return near
    }
    const fs = el.closest('fieldset')
    if (fs) {
      const lg = fs.querySelector('legend')
      if (lg && textOf(lg)) return textOf(lg)
    }
    const group = el.closest('[role="radiogroup"], [role="group"]')
    if (group) {
      const g = labelledBy(group) || clean(group.getAttribute('aria-label'))
      if (g) return g
    }
    const near = precedingText(el, 6)
    if (near) return near
    const seen = visualLabel(el)
    if (seen) return seen
    const ph = el.getAttribute('placeholder')
    if (ph) return clean(ph)
    return clean(el.getAttribute('name') || el.getAttribute('id') || '')
  }

  const sectionOf = (el: Element): string => {
    let node: Element | null = el
    for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
      let prev: Element | null = node.previousElementSibling
      for (let i = 0; prev && i < 8; i++, prev = prev.previousElementSibling) {
        if (/^H[1-4]$/.test(prev.tagName)) return textOf(prev).slice(0, 120)
        const h = prev.querySelector?.('h1, h2, h3, h4')
        if (h && textOf(h)) return textOf(h).slice(0, 120)
      }
    }
    return ''
  }

  const hintOf = (el: Element): string =>
    el.getAttribute('data-automation-id') || el.getAttribute('data-qa') || el.getAttribute('data-ui') || el.getAttribute('data-testid') || ''

  /** A "*" right next to the aria-labelledby text (Workable keeps the star in a sibling span). */
  const starNearLabel = (el: Element): boolean => {
    const ids = el.getAttribute('aria-labelledby')
    if (!ids) return false
    const root = el.getRootNode() as Document | ShadowRoot
    for (const id of ids.split(/\s+/)) {
      const t = root.getElementById ? root.getElementById(id) : document.getElementById(id)
      if (!t) continue
      const base = textOf(t).length
      let p: Element | null = t.parentElement
      for (let i = 0; p && i < 3; i++, p = p.parentElement) {
        const pt = textOf(p)
        if (pt.length > base + 4) break
        if (/^[*✱]|[*✱]$/.test(pt)) return true
      }
    }
    return false
  }

  /** Select-like widgets keep the real (hidden) required input next to the visible one. */
  const requiredTwin = (el: Element): boolean => {
    let p: Element | null = el.parentElement
    for (let i = 0; p && i < 5; i++, p = p.parentElement) {
      if (p.querySelectorAll('input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea').length > 1) return false
      if (p.querySelector('input[required][aria-hidden="true"], input[required][tabindex="-1"], select[required][aria-hidden="true"]')) return true
    }
    return false
  }

  const requiredOf = (el: Element, label: string): boolean =>
    (el as HTMLInputElement).required === true || el.getAttribute('aria-required') === 'true' || isReqText(label) || starNearLabel(el)

  /** Checked state; ARIA widgets (Workable radios) keep it on a role=radio/checkbox wrapper, not the input. */
  const isOn = (el: Element): boolean => {
    const wrap = el.closest('[role="radio"], [role="checkbox"], [role="switch"]')
    const aria = wrap ? wrap.getAttribute('aria-checked') : null
    if (aria === 'true') return true
    if (aria === 'false') return false
    return (el as HTMLInputElement).checked === true
  }

  const fields: Field[] = []
  const seenRadioNames = new Set<string>()
  const seenCheckboxNames = new Set<string>()
  const groupedBoxes = new Set<Element>()

  const errorNear = (el: Element): string => {
    const desc = el.getAttribute('aria-describedby') || el.getAttribute('aria-errormessage')
    if (desc) {
      for (const id of desc.split(/\s+/)) {
        // react-select points at its own placeholder ("Select..."); that is not an error.
        if (/placeholder/i.test(id)) continue
        const root = el.getRootNode() as Document | ShadowRoot
        const d = root.getElementById ? root.getElementById(id) : null
        const t = textOf(d)
        if (!t || t.length > 200) continue
        // Hints ("Please include your full address...") also hang off aria-describedby: only error-looking text counts.
        const errorish = /error|invalid/i.test(id) || !!d?.matches('[class*="error" i], [role="alert"], .invalid-feedback')
        if (errorish || /\b(required|invalid|is not valid|must be|can'?t be blank|cannot be blank|please (enter|select|choose|provide|fill|answer|complete))\b/i.test(t)) return t
      }
    }
    if (el.getAttribute('aria-invalid') === 'true') {
      let node: Element | null = el.parentElement
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        const err = node.querySelector('[class*="error" i], [role="alert"], .invalid-feedback')
        const t = textOf(err)
        if (t && t.length < 200) return t
      }
      return 'invalid'
    }
    return ''
  }

  const optionLabel = (input: Element): string => {
    const id = input.getAttribute('id')
    if (id) {
      const l = rootQuery(input, `label[for="${CSS.escape(id)}"]`)
      if (l && textOf(l)) return textOf(l)
    }
    const wrap = input.closest('label')
    if (wrap && textOf(wrap)) return textOf(wrap)
    const al = input.getAttribute('aria-label')
    if (al) return clean(al)
    const next = input.nextElementSibling
    if (next && textOf(next)) return textOf(next)
    return clean((input as HTMLInputElement).value)
  }

  /**
   * Checkboxes with their own names that still form one question (Workable "select all that apply"):
   * a fieldset or role=group with a question label. Consent lists stay single checkboxes.
   */
  const checkboxGroupOf = (el: Element): { group: Element; label: string; boxes: Element[] } | null => {
    const group = el.closest('fieldset, [role="group"]')
    if (!group) return null
    const boxes = Array.from(group.querySelectorAll('input[type="checkbox"]'))
    if (boxes.length < 2 || boxes.length > 30) return null
    // A fieldset around the whole form is not one question.
    if (group.querySelector('input:not([type="checkbox"]):not([type="hidden"]), select, textarea')) return null
    // Ashby titles its checkbox groups with a <label> as the fieldset's first child instead of a <legend>.
    const title = group.querySelector(':scope > label, :scope > legend')
    // Not an option label (Workable wraps each option's checkbox in its own <label>).
    const ownTitle = title && !title.querySelector('input, [role="checkbox"]') && !boxes.some((b) => b.id && title.getAttribute('for') === b.id) ? textOf(title) : ''
    const label = (group.tagName === 'FIELDSET' ? textOf(group.querySelector('legend')) : '') || ownTitle || labelledBy(group) || clean(group.getAttribute('aria-label'))
    if (!label) return null
    const opts = boxes.map(optionLabel)
    if (opts.some((o) => !o || o.length > 200)) return null
    if (opts.some((o) => /privacy|consent|terms|agree|newsletter|marketing|policy|i (have read|understand|confirm|acknowledge|accept)/i.test(o))) return null
    return { group, label, boxes }
  }

  for (const el of all) {
    const tag = el.tagName
    if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && el.getAttribute('role') !== 'combobox' && !(tag === 'BUTTON' && el.getAttribute('aria-haspopup') === 'listbox') && !choiceMenuOf(el)) continue
    if (el.closest('[data-jf-skip]')) continue
    // Cookie banners are not part of the application.
    if (el.closest('#onetrust-consent-sdk, #CybotCookiebotDialog, #usercentrics-root, [id*="cookie" i], [class*="cookie" i], [role="dialog"][aria-label*="cookie" i], [role="dialog"][aria-label*="consent" i], [class*="consent-banner" i], [class*="cmp-" i]')) continue
    const input = el as HTMLInputElement
    const type = (input.type || '').toLowerCase()
    if (tag === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue
    // Honeypots and hidden trees (files are often hidden behind a styled button: keep them).
    if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && inHiddenTree(el)) continue
    const nameAttr = input.name || ''
    if (/honeypot|^hp_|bot_?field|leave.*blank/i.test(nameAttr)) continue

    let kind: Kind
    if (tag === 'SELECT') kind = 'select'
    else if (tag === 'TEXTAREA') kind = 'textarea'
    else if (tag === 'BUTTON') kind = 'listbox'
    else if (el.getAttribute('role') === 'combobox' || (tag === 'INPUT' && el.getAttribute('aria-autocomplete') === 'list')) kind = 'combobox'
    // Workday multiselect prompts ("Country Phone Code", "How Did You Hear About Us?") are lists with a search box, not text.
    else if (tag === 'INPUT' && type !== 'file' && type !== 'radio' && type !== 'checkbox' && el.closest('[data-uxi-widget-type="multiselect"],[data-automation-id="multiSelectContainer"],[data-automation-id="multiselectInputContainer"]')) kind = 'combobox'
    else if (type === 'file') kind = 'file'
    else if (type === 'radio') kind = 'radio'
    else if (type === 'checkbox') kind = 'checkbox'
    else if (type === 'email') kind = 'email'
    else if (type === 'tel') kind = 'tel'
    else if (type === 'url') kind = 'url'
    else if (type === 'number') kind = 'number'
    else if (type === 'date') kind = 'date'
    else if (type === 'password') kind = 'password'
    else kind = 'text'

    if (kind === 'radio') {
      const groupName = nameAttr || questionLabel(el, true)
      const groupKey = `${(el.getRootNode() as Node).nodeName}|${groupName}`
      if (seenRadioNames.has(groupKey)) continue
      seenRadioNames.add(groupKey)
      const root = el.getRootNode() as Document | ShadowRoot
      const members = nameAttr ? Array.from(root.querySelectorAll(`input[type="radio"][name="${CSS.escape(nameAttr)}"]`)) : [el]
      // A group with no readable question falls back to its name or id ("radio-group-_r_46_"): the input's own
      // aria-label often carries the question instead (LinkedIn Pinpoint).
      const machineId = (s: string) => !/\s/.test(s) && (/[_\d]/.test(s) || (s.match(/-/g) ?? []).length >= 2)
      let label = questionLabel(el, true)
      if (!label || machineId(label)) {
        const own = clean(el.getAttribute('aria-label'))
        if (own && !machineId(own)) label = own
      }
      // LinkedIn's hidden radios label every option with the whole question: then Yes and No look the same and
      // the wrong one could be ticked. Fall back to each option's own value or the text right after it.
      // The value is often just "on" (LinkedIn): text beside the input says Yes / No.
      const generic = (s: string) => !s || /^(on|off|true|false|\d+)$/i.test(s)
      const ownValue = (m: Element) => (generic(clean((m as HTMLInputElement).value)) ? '' : clean((m as HTMLInputElement).value))
      const ownText = (m: Element) => {
        const id = m.getAttribute('id')
        const forLabel = id ? textOf(rootQuery(m, `label[for="${CSS.escape(id)}"]`)) : ''
        const candidates = [textOf(m.nextElementSibling), forLabel, ownValue(m), clean(m.getAttribute('aria-label')), textOf(m.previousElementSibling), textOf(m.parentElement)]
        // The option's own words: never the question again, never "on".
        return candidates.find((t) => !generic(t) && t !== label && t.length < 120) ?? ''
      }
      const raw = members.map(optionLabel)
      const same = raw.length > 1 && new Set(raw).size === 1
      const options = members.map((m, i) => ({ label: same || generic(raw[i]) || (label && raw[i] === label) ? ownText(m) : raw[i], key: keyOf(m), value: (m as HTMLInputElement).value }))
      const checked = members.find(isOn)
      const groupEl = el.closest('fieldset, [role="radiogroup"]')
      fields.push({
        key: keyOf(el),
        kind: 'radio',
        label: stripReq(label),
        name: nameAttr,
        id: input.id || '',
        placeholder: '',
        required: members.some((m) => (m as HTMLInputElement).required || m.getAttribute('aria-required') === 'true') || isReqText(label) || (groupEl ? starNearLabel(groupEl) : false),
        value: checked ? optionLabel(checked) : '',
        options,
        accept: '',
        multiple: false,
        maxLength: null,
        visible: members.some(shownChoice),
        disabled: members.every((m) => (m as HTMLInputElement).disabled),
        section: sectionOf(el),
        hint: hintOf(el),
        error: errorNear(el),
      })
      continue
    }

    if (kind === 'checkbox') {
      if (groupedBoxes.has(el)) continue
      const root = el.getRootNode() as Document | ShadowRoot
      const siblings = nameAttr ? Array.from(root.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(nameAttr)}"]`)) : [el]
      const byGroup = siblings.length > 1 ? null : checkboxGroupOf(el)
      if (byGroup) {
        // Separately named checkboxes that answer one question.
        for (const b of byGroup.boxes) groupedBoxes.add(b)
        const boxes = byGroup.boxes
        fields.push({
          key: keyOf(el),
          kind: 'checkboxes',
          label: stripReq(byGroup.label).slice(0, 600),
          name: nameAttr,
          id: byGroup.group.id || '',
          placeholder: '',
          required:
            boxes.some((m) => (m as HTMLInputElement).required || m.getAttribute('aria-required') === 'true') ||
            isReqText(byGroup.label) ||
            byGroup.group.getAttribute('aria-required') === 'true' ||
            !!byGroup.group.querySelector(':scope > label[class*="required" i]') ||
            starNearLabel(byGroup.group),
          value: boxes.filter(isOn).map(optionLabel).join('; '),
          options: boxes.map((m) => ({ label: optionLabel(m), key: keyOf(m), value: (m as HTMLInputElement).value })),
          accept: '',
          multiple: true,
          maxLength: null,
          visible: boxes.some(shownChoice),
          disabled: boxes.every((m) => (m as HTMLInputElement).disabled),
          section: sectionOf(el),
          hint: hintOf(byGroup.group),
          error: errorNear(el),
        })
        continue
      }
      if (siblings.length > 1) {
        const groupKey = `${root.nodeName}|${nameAttr}`
        if (seenCheckboxNames.has(groupKey)) continue
        seenCheckboxNames.add(groupKey)
        const label = questionLabel(el, true)
        fields.push({
          key: keyOf(el),
          kind: 'checkboxes',
          label: stripReq(label),
          name: nameAttr,
          id: input.id || '',
          placeholder: '',
          required: siblings.some((m) => (m as HTMLInputElement).required) || isReqText(label),
          value: siblings
            .filter(isOn)
            .map(optionLabel)
            .join('; '),
          options: siblings.map((m) => ({ label: optionLabel(m), key: keyOf(m), value: (m as HTMLInputElement).value })),
          accept: '',
          multiple: true,
          maxLength: null,
          visible: siblings.some(shownChoice),
          disabled: siblings.every((m) => (m as HTMLInputElement).disabled),
          section: sectionOf(el),
          hint: hintOf(el),
          error: errorNear(el),
        })
        continue
      }
      // Single checkbox: its own label is the question (consent, "I agree…"). A bare "Agreed" / "Yes" under
      // "By applying, you consent to …*" (Ashby, Sitemark) takes the question too: it carries the meaning and the star.
      // "on" is the browser's default value of a checkbox, not a label (LinkedIn's "Yes on").
      const own = /^(on|true|1)$/i.test(optionLabel(el)) ? '' : optionLabel(el)
      // Ashby puts the question on the fieldset's own label and marks it required with a class, not a star.
      const groupHead = el.closest('fieldset, [role="group"]')?.querySelector(':scope > legend, :scope > label') ?? null
      const groupQuestion = groupHead && !groupHead.contains(el) ? textOf(groupHead) : ''
      const asked = groupQuestion && groupQuestion !== own ? groupQuestion : questionLabel(el)
      const label = own && own.length <= 25 && asked && asked !== own && !asked.includes(own) ? `${asked} ${own}` : own || asked
      const groupRequired = !!groupHead && (/required/i.test(groupHead.getAttribute('class') ?? '') || isReqText(textOf(groupHead)))
      fields.push({
        key: keyOf(el),
        kind: 'checkbox',
        label: stripReq(label).slice(0, 600),
        name: nameAttr,
        id: input.id || '',
        placeholder: '',
        required: input.required || el.getAttribute('aria-required') === 'true' || isReqText(label) || groupRequired,
        value: isOn(el) ? 'true' : 'false',
        options: [],
        accept: '',
        multiple: false,
        maxLength: null,
        // A styled consent box hides the real input; its row is what you see. Only consent: yes/no button
        // groups keep hidden inputs of their own (Ashby).
        visible:
          visibleBox(el) ||
          visibleBox(el.closest('label') ?? el) ||
          (input.id ? !!rootQuery(el, `label[for="${CSS.escape(input.id)}"]`) : false) ||
          (/\b(agree|agreed|consent|privacy|accept|acknowledge)/i.test(label) && !!el.parentElement && visibleBox(el.parentElement)),
        disabled: input.disabled,
        section: sectionOf(el),
        hint: hintOf(el),
        error: errorNear(el),
      })
      continue
    }

    const menu = choiceMenuOf(el)
    // A choice menu's aria-labelledby is "question selected-answer": the question is the first part only.
    let label = menu ? textOf(rootQuery(el, `#${CSS.escape((el.getAttribute('aria-labelledby') ?? '').split(/\s+/)[0] || 'x')}`)) || questionLabel(el) : questionLabel(el)
    // File inputs often sit inside an "Attach" / "Upload" button: the question is the text above it.
    if (kind === 'file' && /^(attach|upload|choose( a)? file|browse|select (a )?file|add (a )?file|drop .*|\+)$/i.test(stripReq(label))) {
      label = precedingText(el.closest('label') ?? el, 6) || label
    }
    let value = ''
    let options: Array<{ label: string; key?: string; value?: string }> = []
    if (kind === 'select') {
      const sel = el as HTMLSelectElement
      options = Array.from(sel.options)
        .filter((o) => o.value !== '' && !/^(select|please select|choose|--)/i.test(clean(o.text)))
        .map((o) => ({ label: clean(o.text), value: o.value }))
      const cur = sel.selectedOptions[0]
      value = cur && cur.value !== '' ? clean(cur.text) : ''
    } else if (kind === 'file') {
      const files = input.files
      value = files && files.length ? Array.from(files).map((f) => f.name).join(', ') : ''
    } else if (kind === 'listbox' && menu) {
      // The entries are in the page even while the menu is closed; the picked one is the labelledby's second part.
      options = Array.from(menu.querySelectorAll('[role="menuitemradio"], [role="menuitemcheckbox"]'))
        .map((o) => clean(o.getAttribute('data-search-text') || textOf(o)))
        .filter(Boolean)
        .map((t) => ({ label: t, value: t }))
      const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).slice(1)
      value = ids.map((id) => textOf(rootQuery(el, `#${CSS.escape(id)}`))).join(' ').trim()
    } else if (kind === 'listbox') {
      const t = textOf(el)
      value = /^(select( one)?|choose|please select|--)/i.test(t) ? '' : t
    } else if (kind === 'combobox') {
      // The chosen value sits beside the input (react-select: value-container > single-value + input-container).
      // Walk up to it; a class match alone stops too early (Greenhouse's input itself is "select__input").
      let control: Element | null = el.parentElement
      for (let i = 0; control && i < 6; i++, control = control.parentElement) {
        if (control.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]')) break
        if (/(^|[\s_-])control\b/i.test(control.getAttribute('class') ?? '')) break
      }
      control = control ?? el.parentElement
      const single = control?.querySelector('[class*="single-value"], [class*="singleValue"], [class*="selected" i]')
      const multi = control ? Array.from(control.querySelectorAll('[class*="multi-value__label"], [class*="multiValue"] [class*="label"]')).map(textOf) : []
      value = textOf(single) || multi.join('; ') || clean(input.value)
      if (/^(select\.*|choose\.*|start typing.*|type to search.*)$/i.test(value)) value = ''
    } else {
      value = clean(input.value)
    }
    fields.push({
      key: keyOf(el),
      kind,
      label: stripReq(label).slice(0, 600),
      name: nameAttr,
      id: input.id || '',
      placeholder: clean(el.getAttribute('placeholder')),
      required: requiredOf(el, label) || ((kind === 'combobox' || kind === 'listbox') && requiredTwin(el)),
      value,
      options,
      accept: input.accept || '',
      multiple: input.multiple === true || el.getAttribute('aria-multiselectable') === 'true',
      maxLength: input.maxLength && input.maxLength > 0 ? input.maxLength : null,
      visible: kind === 'file' ? true : visibleBox(el),
      disabled: input.disabled === true || el.getAttribute('aria-disabled') === 'true',
      section: sectionOf(el),
      hint: hintOf(el),
      asyncOptions: kind === 'combobox' && /location|city|address|school|university|search/i.test(label + ' ' + nameAttr + ' ' + (input.id || '')),
      error: errorNear(el),
    })
  }

  // Choice buttons (Ashby yes/no, button groups): a question label + 2-8 short buttons, no inputs.
  const buttonGroups = new Set<Element>()
  for (const el of all) {
    if (el.tagName !== 'BUTTON') continue
    // Only an explicit type=submit: Ashby's yes/no buttons have no type attribute, so .type reads "submit".
    if (el.getAttribute('type')?.toLowerCase() === 'submit') continue
    const parent = el.parentElement
    if (!parent || buttonGroups.has(parent)) continue
    const btns = Array.from(parent.children).filter((c) => c.tagName === 'BUTTON') as HTMLButtonElement[]
    if (btns.length < 2 || btns.length > 8) continue
    // Ashby keeps a hidden backing checkbox inside its yes/no group; only a real input rules the group out.
    const realInput = Array.from(parent.querySelectorAll('input, select, textarea')).some(
      (i) => (i as HTMLInputElement).type !== 'hidden' && i.getAttribute('tabindex') !== '-1' && i.getAttribute('aria-hidden') !== 'true',
    )
    if (realInput) continue
    const texts = btns.map((b) => textOf(b))
    if (texts.some((t) => !t || t.length > 40)) continue
    if (!texts.some((t) => /^(yes|no|ja|nein|oui|non)$/i.test(t)) && !parent.matches('[class*="yesno" i], [class*="choice" i], [role="radiogroup"], [role="group"]')) continue
    buttonGroups.add(parent)
    const label = questionLabel(parent, true)
    const selected = btns.find((b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-checked') === 'true' || /\b(active|selected|checked|_active|isSelected)\b/i.test(b.className))
    fields.push({
      key: keyOf(parent),
      kind: 'buttons',
      label: stripReq(label).slice(0, 600),
      name: '',
      id: parent.id || '',
      placeholder: '',
      // Ashby draws the "*" with CSS and marks the question label with a "required" class instead.
      required: isReqText(label) || parent.getAttribute('aria-required') === 'true' || !!parent.parentElement?.querySelector(':scope > label[class*="required" i]'),
      value: selected ? textOf(selected) : '',
      options: btns.map((b) => ({ label: textOf(b), key: keyOf(b) })),
      accept: '',
      multiple: false,
      maxLength: null,
      visible: visibleBox(parent),
      disabled: btns.every((b) => b.disabled),
      section: sectionOf(parent),
      hint: hintOf(parent),
    })
  }

  // Buttons and links that move the flow (apply, next, submit, sign in).
  const buttons: Button[] = []
  // A script-driven "Apply" (type="button") that sends the form around it (Arbeitnow): only when it is the form's one Apply.
  const onlyApplyInForm = (el: Element): boolean =>
    Array.from(el.closest('form')?.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]') ?? []).filter(
      (b) => visibleBox(b) && /^(apply|apply now|jetzt bewerben|postuler)$/i.test(clean(b.tagName === 'INPUT' ? (b as HTMLInputElement).value : textOf(b))),
    ).length === 1
  const navEls = all.filter((el) => {
    const t = el.tagName
    return t === 'BUTTON' || t === 'A' || el.getAttribute('role') === 'button' || (t === 'INPUT' && ['submit', 'button'].includes((el as HTMLInputElement).type))
  })
  for (const el of navEls) {
    if (el.parentElement && buttonGroups.has(el.parentElement)) continue
    if (el.getAttribute('aria-haspopup') === 'listbox' || choiceMenuOf(el)) continue
    // A web-component button (SmartRecruiters) renders <button><slot></slot></button>: its words are the slotted ones.
    const slotted = () =>
      Array.from(el.querySelectorAll('slot'))
        .flatMap((s) => (s as HTMLSlotElement).assignedNodes({ flatten: true }))
        .map((n) => n.textContent ?? '')
        .join(' ')
    const text = clean(el.tagName === 'INPUT' ? (el as HTMLInputElement).value : textOf(el) || slotted() || el.getAttribute('aria-label') || el.getAttribute('title'))
    // Long texts are menus or paragraphs, except "Apply Now for Software Engineer II - EDR Workflows - Security" (Elastic).
    if (!text || (text.length > 60 && !(text.length <= 160 && /^(apply|jetzt bewerben|bewerben|postuler)\b/i.test(text)))) continue
    const visible = visibleBox(el)
    if (!visible) continue
    const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href || '' : ''
    const lower = text.toLowerCase()
    let kind: Button['kind'] = 'other'
    const isSubmitType = (el as HTMLButtonElement).type === 'submit' && el.tagName !== 'A'
    const formWithFields = !!el.closest('form')?.querySelector('input[type="email"], input[type="file"], input[type="tel"]')
    if (/^(submit( (my |your )?application)?|send( (my )?application)?|submit and (finish|continue)|complete( (my )?application)?|finish|bewerbung (absenden|senden|abschicken)|absenden|envoyer( (ma |la )?candidature)?|soumettre( (ma )?candidature)?|enviar( (mi |la )?(candidatura|solicitud))?|invia( candidatura)?|verzenden|sollicitatie versturen|apply without (saving|an account|signing in)|submit as guest|send (my |your )?application now)$/i.test(lower)) kind = 'submit'
    else if (/^(apply|apply now|jetzt bewerben|postuler)$/i.test(lower) && formWithFields && (isSubmitType || onlyApplyInForm(el))) kind = 'submit'
    // "next offer" / "next job" walk to another posting (NoFluffJobs), not to the form's next step.
    else if (/^(next|continue|save (and|&) continue|save and next|proceed|weiter|suivant|volgende|siguiente|avanti|review( (my |your )?application)?|next step|continue to (next step|review))\b/i.test(lower) && !/\b(offer|job|jobs|posting|vacanc|article|post|story|page|slide|image|photo)s?\b/i.test(lower.replace(/^next step/, ''))) kind = 'next'
    else if (/^(back|previous|zurück|précédent|vorige)\b/i.test(lower)) kind = 'back'
    else if (/^(sign in|log in|login|anmelden|se connecter|inloggen)$/i.test(lower)) kind = 'login'
    else if (/^(create account|sign up|register|registrieren|créer un compte)$/i.test(lower)) kind = 'signup'
    else if (/(^apply\b|^easy apply\b|apply (now|for (this )?(job|role|position))|apply (online|here)|i'?m interested|bewerben|jetzt bewerben|postuler|candidat(ar|er)|solliciteer|start (your )?application|begin application|apply manually|autofill with resume|use my last application)/i.test(lower) && !/linkedin|indeed|xing|seek|similar|alert|share|save|referr?al|friend/i.test(lower + ' ' + href)) kind = 'apply'
    // A newsletter's "Subscribe" is never an application's Submit (NoFluffJobs once signed the user up for alerts twice).
    // Also in the form's language: Teamtailor's "Borrar selección de archivos" (clear the chosen files) was
    // pressed as Submit at Q-Tech and removed the CV.
    else if (isSubmitType && formWithFields && !/instead|here|manual|paste|upload|attach|browse|add|remove|delete|cancel|edit|clear|change|show|hide|more|subscribe|newsletter|alert|notify|sign ?up|register|borrar|eliminar|quitar|limpiar|cancelar|editar|cambiar|subir|adjuntar|añadir|agregar|löschen|entfernen|abbrechen|hochladen|hinzufügen|bearbeiten|ändern|supprimer|effacer|annuler|modifier|ajouter|joindre|verwijderen|annuleren|wissen|toevoegen|rimuovi|elimina|annulla|carica|aggiungi|remover|apagar|anexar|adicionar|carregar|limpar|excluir|alterar|descartar/i.test(lower)) {
      // A button without a type attribute also reads type "submit" ("Write it here instead"): only the form's one such button counts.
      const explicit = (el.getAttribute('type') || '').toLowerCase() === 'submit' || el.tagName === 'INPUT'
      const typeless = Array.from(el.closest('form')?.querySelectorAll('button:not([type])') ?? []).filter((b) => visibleBox(b))
      if (explicit || typeless.length === 1) kind = 'submit'
    }
    // Plain links are only interesting when they move the flow; menus would crowd out the form buttons.
    if (kind === 'other' && el.tagName === 'A') continue
    buttons.push({ key: keyOf(el), text, kind, tag: el.tagName.toLowerCase(), href, visible, disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' })
  }

  // CAPTCHA: only a visible challenge or checkbox needs a person; the invisible badge does not.
  let captcha: FrameScan['captcha'] = null
  // aria-hidden does not hide a challenge: hCaptcha marks its own frames that way. Only styles do.
  const styledAway = (el: Element): boolean => {
    for (let n: Element | null = el; n; n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)) if (styleHidden(n)) return true
    return false
  }
  for (const f of Array.from(document.querySelectorAll('iframe'))) {
    const src = f.getAttribute('src') || ''
    const box = f.getBoundingClientRect()
    const shown = box.width > 60 && box.height > 60 && !styledAway(f)
    if (/recaptcha\/(api2|enterprise)\/bframe/.test(src) && shown) captcha = { kind: 'recaptcha', challengeVisible: true }
    else if (/recaptcha\/(api2|enterprise)\/anchor/.test(src) && !/size=invisible/.test(src) && shown) captcha = captcha ?? { kind: 'recaptcha', challengeVisible: true }
    else if (/hcaptcha\.com/.test(src) && /frame=challenge/.test(src) && shown) captcha = { kind: 'hcaptcha', challengeVisible: true }
    else if (/hcaptcha\.com/.test(src) && /frame=checkbox/.test(src) && shown) captcha = captcha ?? { kind: 'hcaptcha', challengeVisible: true }
    // hCaptcha's "enclave" frames (Lever, frame=en) stay hidden until a puzzle opens: shown at all means a person is needed.
    else if (/hcaptcha\.com/.test(src) && shown) captcha = captcha ?? { kind: 'hcaptcha', challengeVisible: true }
    else if (/challenges\.cloudflare\.com/.test(src) && shown) captcha = { kind: 'turnstile', challengeVisible: true }
    // The puzzle frame by its title, whatever its address (Lever's hCaptcha "Click on the TWO groups...").
    else if (!captcha && /h?captcha (security )?challenge|recaptcha challenge/i.test(f.getAttribute('title') || '') && box.width > 150 && box.height > 150 && !styledAway(f)) {
      captcha = { kind: /recaptcha/i.test(f.getAttribute('title') || '') ? 'recaptcha' : 'hcaptcha', challengeVisible: true }
    }
  }
  // Turnstile draws its checkbox in a closed shadow root (Workable): the unanswered token box beside it gives it away.
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="cf-turnstile-response"]'))) {
    const widget = input.parentElement
    const box = widget?.getBoundingClientRect()
    if (!captcha && widget && box && box.width > 60 && box.height > 40 && !input.value && !styledAway(widget)) captcha = { kind: 'turnstile', challengeVisible: true }
  }
  const bodyText = textOf(document.body)
  if (!captcha && /(verify (that )?you are (a )?human|are you a robot|press (&|and) hold|checking your browser|just a moment\.\.\.)/i.test(bodyText.slice(0, 3000))) {
    captcha = { kind: 'text', challengeVisible: true }
  }
  // Lever after a failed hidden hCaptcha: no puzzle on screen yet, only this banner; the next Submit shows one.
  if (!captcha && /there was an error verifying your application/i.test(bodyText)) captcha = { kind: 'hcaptcha', challengeVisible: true }

  const successMatch =
    /(thank you for (applying|your application|submitting)|thanks for applying|application (has been |was )?(successfully )?(submitted|received|sent|complete)|we('ve| have)? (successfully )?received your application|we(['’]ve| have) got your application|you['’]re all set|your application is (on its way|in|complete)\b|application (has been |was )?(successfully )?(recorded|accepted)|your (job )?application (has been|was) (successfully )?(submitted|received|sent)|successfully (applied|submitted)|we(['’]ll| will) (now )?review your application|we(['’]re| are) (now )?reviewing your application|you['’]re in the mix|thanks? (you )?for your interest in joining|bewerbung (wurde |ist )?(bei uns )?(erfolgreich )?(versendet|eingegangen|übermittelt|abgeschickt)|vielen dank für (ihre|deine) bewerbung|wir haben (ihre|deine) bewerbung erhalten|candidature (a (bien )?été |est )?(envoyée|reçue|transmise)|merci (pour|de) votre candidature|bedankt voor je sollicitatie|gracias por (tu|su) (solicitud|candidatura))/i.exec(
      // The tail too: Aiven's "Thanks, your application is in" sat at character 6619, under the job text,
      // so the submit looked failed and the job was applied to twice.
      bodyText.length > 10000 ? `${bodyText.slice(0, 6000)} ${bodyText.slice(-4000)}` : bodyText,
    )

  const errors: string[] = []
  for (const el of all) {
    if (!(el.getAttribute('role') === 'alert' || /(^|\s|-|_)(error|errors|invalid|alert-danger|field-error|error-message)(\s|$|-|_)/i.test(el.getAttribute('class') || ''))) continue
    if (!visibleBox(el)) continue
    const t = textOf(el)
    if (t && t.length > 2 && t.length < 300 && !errors.includes(t)) errors.push(t)
    if (errors.length >= 12) break
  }

  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(textOf)
    .filter((t) => t && t.length < 160)
    .slice(0, 12)

  const codePrompt =
    /(security|verification|confirmation|one-time|6-digit|8-character) code|enter the code|code (we|that we) (sent|emailed)|check your (email|inbox) for (a|the) code/i.test(bodyText.slice(0, 5000)) &&
    fields.some((f) => f.visible && (f.kind === 'text' || f.kind === 'number' || f.kind === 'tel') && (f.maxLength === null || f.maxLength <= 12))

  return {
    url: location.href,
    title: document.title,
    fields,
    buttons: [...buttons.filter((b) => b.kind !== 'other'), ...buttons.filter((b) => b.kind === 'other')].slice(0, 80),
    headings,
    textSample: bodyText.slice(0, 5000),
    hasPassword: fields.some((f) => f.kind === 'password' && f.visible),
    captcha,
    successText: successMatch ? successMatch[0] : null,
    errors,
    codePrompt,
  }
}

/**
 * Options currently shown in an open dropdown (react-select, Workday listbox, ARIA listbox).
 * With `owner` (the data-jf-key of the control that opened it), only the list that control points
 * to via aria-controls/aria-owns is read: another dropdown may still be closing (Workable).
 */
export function readOpenOptionsInPage(arg: { prefix: string; owner?: string }): Array<{ label: string; key: string }> {
  const w = window as unknown as { __jfSeq?: number }
  if (!w.__jfSeq) w.__jfSeq = 0
  const out: Array<{ label: string; key: string }> = []
  const seen = new Set<string>()
  const els: Element[] = []
  const OPTION_SEL =
    '[role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [data-automation-id="promptOption"], [class*="select__option"], li[id*="option"], .dropdown-results > div, .pac-container .pac-item, [class*="suggestion" i] li, [class*="autocomplete" i] li, [class*="dropdown-location" i], ul[role="listbox"] > li'
  const walk = (root: Document | ShadowRoot | Element) => {
    for (const el of Array.from(root.querySelectorAll(OPTION_SEL))) els.push(el)
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = (el as HTMLElement).shadowRoot
      if (sr) walk(sr)
    }
  }
  const owner = arg.owner ? document.querySelector(`[data-jf-key="${arg.owner}"]`) : null
  const ownedIds = owner ? `${owner.getAttribute('aria-controls') || ''} ${owner.getAttribute('aria-owns') || ''}`.split(/\s+/).filter(Boolean) : []
  const ownRoot = owner ? (owner.getRootNode() as Document | ShadowRoot) : document
  const owned = ownedIds.map((id) => (ownRoot.getElementById ? ownRoot.getElementById(id) : document.getElementById(id))).filter((x): x is HTMLElement => Boolean(x))
  for (const list of owned) walk(list)
  // No owned list (or it holds no options): read every open list on the page.
  if (!els.length) walk(document)
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    // SmartRecruiters' spl-dropdown-item: the shadow option's text comes through a <slot>, so its own innerText is
    // empty and the option was skipped ("Where did you initially see this job?" stayed invalid).
    const slotted = Array.from(el.querySelectorAll('slot'))
      .flatMap((s) => (s as HTMLSlotElement).assignedNodes({ flatten: true }))
      .map((n) => (n as HTMLElement).innerText ?? n.textContent ?? '')
      .join(' ')
    const rootNode = el.getRootNode()
    const hostText = rootNode instanceof ShadowRoot ? ((rootNode.host as HTMLElement).innerText ?? '') : ''
    const label = ((el as HTMLElement).innerText || el.textContent || slotted || hostText || '').replace(/\s+/g, ' ').trim()
    if (!label || label.length > 200 || seen.has(label)) continue
    seen.add(label)
    let k = el.getAttribute('data-jf-key')
    if (!k) {
      w.__jfSeq = (w.__jfSeq ?? 0) + 1
      k = `${arg.prefix}${w.__jfSeq}`
      el.setAttribute('data-jf-key', k)
    }
    out.push({ label, key: k })
    if (out.length >= 150) break
  }
  return out
}
