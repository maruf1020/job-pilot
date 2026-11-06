import { hostOf } from '../match'

/**
 * What the agent knows about each application system (plan-apply-all.md 7.1), learned from 2,192
 * real attempts. One small record per vendor: how to reach its form directly, how
 * long a form there should take, what kind of CAPTCHA it shows and where the agent should run it.
 */

/**
 * none          no CAPTCHA seen
 * invisible     an invisible check (reCAPTCHA v3 / Greenhouse) that rarely asks anything
 * after-submit  the challenge appears only after Submit, mostly to the hidden browser (Ashby reCAPTCHA images, Lever hCaptcha)
 * turnstile     Cloudflare Turnstile: passes by itself in a normal Chrome, never in the hidden one (Personio, Workable)
 * checkbox      a reCAPTCHA "I'm not a robot" box on every form (BambooHR, JazzHR): always a person
 */
export type VendorCaptcha = 'none' | 'invisible' | 'after-submit' | 'turnstile' | 'checkbox'

export interface VendorAdapter {
  id: string
  label: string
  /** The URL belongs to this system (posting or form). */
  match: (url: string) => boolean
  /** The form itself, from a posting URL, when the system has a fixed pattern; null = open the posting. */
  formUrl?: (url: string) => string | null
  captcha: VendorCaptcha
  /** The hidden browser is walled or challenged here every time: run it in your Chrome from the start. */
  preferYourChrome?: boolean
  /** Minutes a form here may take before the attempt gives up. */
  budgetMinutes: number
  /** Words this system shows once the application went through, beside the generic patterns. */
  confirmation?: RegExp
  /** Notes for the logs and the dashboard: what usually goes wrong here. */
  notes?: string
}

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const strip = (url: string) => url.split('#')[0].replace(/\/+$/, '')

export const ADAPTERS: VendorAdapter[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    match: (u) => /(^|\.)greenhouse\.io$/.test(host(u)) || /[?&]gh_jid=\d+/.test(u),
    captcha: 'invisible',
    budgetMinutes: 6,
    confirmation: /thank you for applying|application (has been )?received/i,
    notes: 'Invisible reCAPTCHA; an 8-character code may be emailed after Submit (read from Gmail).',
  },
  {
    id: 'ashby',
    label: 'Ashby',
    match: (u) => host(u) === 'jobs.ashbyhq.com',
    formUrl: (u) => (/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}\/?$/.test(strip(u)) ? `${strip(u)}/application` : null),
    captcha: 'after-submit',
    budgetMinutes: 6,
    confirmation: /thank(s| you) for (applying|your application)|application (was |has been )?(submitted|received)/i,
    notes: 'reCAPTCHA Enterprise shows image puzzles to the hidden browser after Submit; your Chrome usually passes.',
  },
  {
    id: 'lever',
    label: 'Lever',
    match: (u) => /^jobs\.(eu\.)?lever\.co$/.test(host(u)),
    formUrl: (u) => (/jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}$/.test(strip(u)) ? `${strip(u)}/apply` : /\/apply$/.test(strip(u)) ? strip(u) : null),
    captcha: 'after-submit',
    preferYourChrome: true,
    budgetMinutes: 6,
    confirmation: /application submitted|thanks for applying/i,
    notes: 'hCaptcha after Submit in the hidden browser (27 of 33 attempts); rarely in a real Chrome.',
  },
  {
    id: 'workable',
    label: 'Workable',
    match: (u) => host(u) === 'apply.workable.com' || /\.workable\.com$/.test(host(u)),
    captcha: 'turnstile',
    budgetMinutes: 6,
    notes: 'Cloudflare Turnstile appears after Submit in the hidden browser.',
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    match: (u) => /(^|\.)smartrecruiters\.com$/.test(host(u)),
    captcha: 'none',
    preferYourChrome: true,
    budgetMinutes: 8,
    notes: 'A bot wall (DataDome) blocks the hidden browser on every posting; your Chrome passes.',
  },
  {
    id: 'personio',
    label: 'Personio',
    match: (u) => /\.jobs\.personio\.(de|com)$/.test(host(u)),
    formUrl: (u) => {
      const m = /^(https:\/\/[^/]+\.jobs\.personio\.(?:de|com)\/job\/\d+)(?:\/apply)?(?:[/?].*)?$/.exec(u.split('#')[0])
      return m ? `${m[1]}/apply` : null
    },
    captcha: 'turnstile',
    preferYourChrome: true,
    budgetMinutes: 7,
    confirmation: /thank you for your application|application (has been )?(sent|submitted)|bewerbung (wurde )?(erfolgreich )?(versendet|übermittelt)/i,
    notes: 'Cloudflare Turnstile under the form: never passes in the hidden browser, usually by itself in your Chrome.',
  },
  {
    id: 'recruitee',
    label: 'Recruitee',
    match: (u) => /\.recruitee\.com$/.test(host(u)),
    formUrl: (u) => (/recruitee\.com\/o\/[^/]+$/.test(strip(u).split('?')[0]) ? `${strip(u).split('?')[0]}/c/new` : null),
    captcha: 'none',
    budgetMinutes: 6,
    notes: 'The phone box starts with the local dial code: the full international number (with its country code) goes in it.',
  },
  {
    id: 'teamtailor',
    label: 'Teamtailor',
    match: (u) => /\.teamtailor\.com$/.test(host(u)) || /\/jobs\/\d+-[^/]+\/applications/.test(u),
    captcha: 'none',
    budgetMinutes: 7,
    notes: 'Some companies email a confirmation link before the application counts (read from Gmail).',
  },
  {
    id: 'bamboohr',
    label: 'BambooHR',
    match: (u) => /\.bamboohr\.com$/.test(host(u)),
    captcha: 'checkbox',
    budgetMinutes: 6,
    notes: 'A reCAPTCHA "I am not a robot" box on every form: always yours to tick.',
  },
  {
    id: 'jazzhr',
    label: 'JazzHR',
    match: (u) => /(^|\.)applytojob\.com$/.test(host(u)) || /(^|\.)jazz\.co$/.test(host(u)),
    captcha: 'checkbox',
    budgetMinutes: 6,
    notes: 'A reCAPTCHA "I am not a robot" box on every form: always yours to tick.',
  },
  {
    id: 'join',
    label: 'JOIN',
    match: (u) => host(u) === 'join.com' || host(u).endsWith('.join.com'),
    captcha: 'none',
    budgetMinutes: 6,
    notes: 'Many postings only continue through an emailed sign-in link that creates a JOIN account: yours to decide.',
  },
  {
    id: 'wttj',
    label: 'Welcome to the Jungle',
    match: (u) => /(^|\.)welcometothejungle\.com$/.test(host(u)),
    captcha: 'none',
    preferYourChrome: true,
    budgetMinutes: 6,
    notes: 'Answers the hidden browser with 403 and asks for a sign-in: log in once in your Chrome.',
  },
  {
    id: 'workday',
    label: 'Workday',
    match: (u) => /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/.test(host(u)),
    captcha: 'none',
    budgetMinutes: 12,
    notes: 'An account per company site; a multi-step wizard.',
  },
  { id: 'breezy', label: 'Breezy', match: (u) => /\.breezy\.hr$/.test(host(u)), captcha: 'none', budgetMinutes: 6 },
  { id: 'pinpoint', label: 'Pinpoint', match: (u) => /\.pinpointhq\.com$/.test(host(u)), captcha: 'none', budgetMinutes: 6 },
  { id: 'rippling', label: 'Rippling', match: (u) => /(^|\.)rippling\.com$/.test(host(u)), captcha: 'none', budgetMinutes: 8 },
  { id: 'dover', label: 'Dover', match: (u) => /(^|\.)dover\.(com|io)$/.test(host(u)), captcha: 'none', budgetMinutes: 6 },
  { id: 'softgarden', label: 'softgarden', match: (u) => /softgarden\.(io|de)$/.test(host(u)), captcha: 'none', budgetMinutes: 8 },
  { id: 'homerun', label: 'Homerun', match: (u) => /\.homerun\.co$/.test(host(u)), captcha: 'none', budgetMinutes: 6 },
  { id: 'linkedin', label: 'LinkedIn Easy Apply', match: (u) => /(^|\.)linkedin\.com$/.test(host(u)), captcha: 'none', preferYourChrome: true, budgetMinutes: 10 },
]

/** The system a URL belongs to, or null for a company's own site. */
export function adapterFor(url: string | null | undefined): VendorAdapter | null {
  if (!url) return null
  return ADAPTERS.find((a) => a.match(url)) ?? null
}

export function adapterById(id: string | null | undefined): VendorAdapter | null {
  if (!id) return null
  return ADAPTERS.find((a) => a.id === id) ?? null
}

/** The direct form link for a posting on a known system, or null when the posting must be opened. */
export function vendorFormUrl(url: string): string | null {
  const a = adapterFor(url)
  if (!a?.formUrl) return null
  try {
    return a.formUrl(url)
  } catch {
    return null
  }
}

/**
 * Where a batch should run this posting: your Chrome when the hidden browser is walled or challenged
 * there every time (Lever hCaptcha, Personio Turnstile, SmartRecruiters' bot wall, Welcome to the
 * Jungle's 403, LinkedIn sign-in). For portal-batch's background/your-Chrome choice.
 */
export function runsInYourChrome(url: string | null | undefined): boolean {
  return adapterFor(url)?.preferYourChrome === true
}

/** Forms with a CAPTCHA box on every page (BambooHR, JazzHR): the agent cannot finish them alone. */
export function alwaysCaptcha(url: string | null | undefined): boolean {
  return adapterFor(url)?.captcha === 'checkbox'
}

/** The apply lane of an attempt, for the triage tables and the scoreboard. */
export function laneFor(url: string | null | undefined, opts: { batch: boolean }): 'ats' | 'other' | 'linkedin' | 'single' {
  if (!opts.batch) return 'single'
  const a = adapterFor(url)
  if (a?.id === 'linkedin') return 'linkedin'
  return a ? 'ats' : 'other'
}

/** Hosts that serve many companies: one company's closed postings must not mark the whole system as bad. */
const SHARED_HOSTS = /^(job-boards(\.eu)?\.greenhouse\.io|boards(\.eu)?\.greenhouse\.io|jobs(\.eu)?\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com|join\.com|welcometothejungle\.com)$/

/**
 * The key a website is tracked under in the host triage table (HostProfile.host, PortalAttempt.host):
 * the host, plus the company's part of the path on systems shared by many companies
 * ("jobs.lever.co/kpler", "join.com/pflegia"). Lookups must use the same key.
 */
export function triageKey(url: string | null | undefined): string | null {
  if (!url) return null
  const h = hostOf(url)
  if (!h) return null
  if (!SHARED_HOSTS.test(h)) return h
  let parts: string[] = []
  try {
    const u = new URL(url)
    parts = u.pathname.split('/').filter(Boolean)
    // Greenhouse embeds name the board in ?for=
    const forParam = u.searchParams.get('for')
    if (forParam) return `${h}/${forParam.toLowerCase()}`
  } catch {
    return h
  }
  const company = h === 'join.com' ? (parts[0] === 'companies' ? parts[1] : undefined) : h === 'welcometothejungle.com' ? parts[parts.indexOf('companies') + 1] : parts[0]
  return company && !/^(embed|j|jobs|companies|en|fr|de|es)$/i.test(company) ? `${h}/${company.toLowerCase()}` : h
}

/** Host key to record on an attempt: the form's, else the start page's. */
export function attemptHost(formUrl: string | null | undefined, startUrl: string | null | undefined): string | null {
  return triageKey(formUrl) ?? triageKey(startUrl)
}
