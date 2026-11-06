'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleUserRound, Cpu, KeyRound, ListOrdered, Mail, MousePointerClick, ScanSearch, Search, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react'
import { SETTINGS_TABS } from '@/components/layout/nav'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  '/settings/account': CircleUserRound,
  '/settings': SlidersHorizontal,
  '/settings/search': Search,
  '/settings/ranking': ListOrdered,
  '/settings/email': Mail,
  '/settings/ai': Cpu,
  '/settings/keys': KeyRound,
  '/settings/browser': MousePointerClick,
  '/settings/scraping': ScanSearch,
  '/settings/profile': UserRound,
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/settings') return pathname === '/settings'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Settings sub-navigation: scrollable underline tabs below lg, a vertical side menu from lg up
 * (plan-ui-redesign.md, Group D). One list, so every tab is a single link.
 */
export function SettingsTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="Settings sections" className="-mx-3 border-b sm:mx-0 lg:sticky lg:top-[calc(var(--header-height,3.5rem)+1.5rem)] lg:mx-0 lg:border-0">
      <ul className="flex min-w-0 overflow-x-auto px-3 scrollbar-none sm:px-0 lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {SETTINGS_TABS.map((tab) => {
          const active = isActive(pathname, tab.href)
          const Icon = ICONS[tab.href] ?? SlidersHorizontal
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                data-active={active}
                className={cn(
                  'inline-flex items-center gap-2 text-sm font-medium whitespace-nowrap transition-colors',
                  // Phones and tablets: underline tabs.
                  '-mb-px h-10 border-b-2 px-3',
                  // Desktop: side menu rows.
                  'lg:mb-0 lg:flex lg:h-8 lg:w-full lg:rounded-md lg:border-b-0 lg:px-2.5',
                  active
                    ? 'border-primary text-foreground lg:bg-accent lg:text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground lg:hover:bg-accent/60',
                )}
              >
                <Icon className={cn('hidden size-4 shrink-0 lg:block', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
