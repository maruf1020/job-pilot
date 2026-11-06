import { BarChart3, Briefcase, Building2, CircleAlert, Gauge, Globe, Handshake, Mail, PlayCircle, Send, Settings, type LucideIcon } from 'lucide-react'

export type NavKey = 'today' | 'stats' | 'opportunities' | 'queue' | 'mail' | 'jobs' | 'applications' | 'companies' | 'runs' | 'hosts' | 'settings'

export interface NavItem {
  key: NavKey
  href: string
  label: string
  icon: LucideIcon
  /** Shown in the mobile bottom bar (the rest live in the "More" sheet). */
  mobile?: boolean
  /** Extra words the command menu matches on. */
  keywords?: string[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Information architecture (plan-ui-redesign.md section 2): act first, then the pipeline, then the machinery. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Act',
    items: [
      { key: 'today', href: '/dashboard', label: 'Today', icon: Gauge, mobile: true, keywords: ['dashboard', 'home', 'overview'] },
      { key: 'stats', href: '/stats', label: 'Stats', icon: BarChart3, keywords: ['analytics', 'charts', 'graph', 'numbers', 'submitted', 'this week', 'total', 'gemini', 'ai usage'] },
      { key: 'opportunities', href: '/opportunities', label: 'Opportunities', icon: Handshake, keywords: ['who wants me', 'in progress', 'interview', 'offer', 'process', 'next steps', 'leads'] },
      { key: 'queue', href: '/queue', label: 'Needs you', icon: CircleAlert, mobile: true, keywords: ['captcha', 'questions', 'help', 'queue'] },
      { key: 'mail', href: '/mail', label: 'Mail', icon: Mail, mobile: true, keywords: ['inbox', 'replies', 'email', 'sent', 'drafts', 'interview', 'important', 'waiting', 'held'] },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { key: 'jobs', href: '/jobs', label: 'Jobs', icon: Briefcase, mobile: true, keywords: ['postings', 'roles', 'search'] },
      { key: 'applications', href: '/applications', label: 'Applications', icon: Send, keywords: ['apply', 'sent', 'board', 'batch'] },
      { key: 'companies', href: '/companies', label: 'Companies', icon: Building2, keywords: ['employers', 'sponsors', 'boards'] },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'runs', href: '/runs', label: 'Runs', icon: PlayCircle, keywords: ['search runs', 'sources', 'logs'] },
      { key: 'hosts', href: '/hosts', label: 'Hosts', icon: Globe, keywords: ['websites', 'sites', 'skip'] },
      { key: 'settings', href: '/settings', label: 'Settings', icon: Settings, keywords: ['preferences', 'config', 'account', 'password', 'profile', 'keys', 'api keys'] },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export const SETTINGS_TABS = [
  { href: '/settings/account', label: 'Account' },
  { href: '/settings', label: 'General' },
  { href: '/settings/search', label: 'Search' },
  { href: '/settings/ranking', label: 'Ranking' },
  { href: '/settings/email', label: 'Email' },
  { href: '/settings/ai', label: 'AI' },
  { href: '/settings/keys', label: 'Keys & services' },
  { href: '/settings/browser', label: 'Browser' },
  { href: '/settings/scraping', label: 'Scraping' },
  { href: '/settings/profile', label: 'Profile' },
] as const

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href || pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** Page title for the top bar: the nav item, then the detail level ("Jobs / Detail"). */
export function pageTitle(pathname: string): { section: string; href: string | null; detail: string | null } {
  const item = NAV_ITEMS.find((i) => isActivePath(pathname, i.href))
  if (!item) return { section: 'Job Pilot', href: null, detail: null }
  if (item.key === 'settings') {
    const tab = SETTINGS_TABS.find((t) => t.href !== '/settings' && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    return { section: item.label, href: item.href, detail: tab?.label ?? null }
  }
  const rest = pathname.slice(item.href.length).replace(/^\//, '')
  const detail = rest ? ({ jobs: 'Job', applications: 'Application', companies: 'Company', runs: 'Run' } as Record<string, string>)[item.key] ?? 'Detail' : null
  return { section: item.label, href: item.href, detail }
}
