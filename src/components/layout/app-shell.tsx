'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, CircleUserRound, Laptop, LogOut, Menu, Moon, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useApiQuery } from '@/lib/api/hooks'
import { logoutAction } from '@/lib/auth/actions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { LogoMark } from '@/components/brand/logo'
import { useNeedsYouQueue } from '@/components/queue/needs-you'
import { CommandMenuProvider, Kbd, useCommandMenu } from './command-menu'
import { isActivePath, NAV_GROUPS, NAV_ITEMS, pageTitle, type NavKey } from './nav'
import { NotificationsBell } from './notifications-bell'
import { StatusChip } from './status-chip'

/** The signed-in owner: the account name, and the optional account email. */
type User = { name: string; email: string | null }

/** Replies waiting for an answer from you, and the next steps among them; shares its cache with the Mail page. */
function useNeedsActionCounts(): { inbox: number; wantYou: number } {
  const q = useApiQuery<{ needsYou: unknown[]; nextSteps: Array<{ answered: boolean; status: string }> }>(['inbox', 'needs-action'], '/api/inbox/needs-action', { refetchInterval: 60_000 })
  const d = q.data?.data
  // Same rule as the Opportunities page: answered or since rejected is not waiting for you.
  return { inbox: d?.needsYou.length ?? 0, wantYou: d?.nextSteps.filter((n) => !n.answered && n.status !== 'REJECTED' && n.status !== 'SKIPPED').length ?? 0 }
}

/** Counts shown next to nav items (only where something waits for you). */
function useNavCounts(): Partial<Record<NavKey, { count: number; label: string }>> {
  const { inbox, wantYou } = useNeedsActionCounts()
  const queue = useNeedsYouQueue().data?.data.counts.total ?? 0
  return {
    ...(wantYou > 0 ? { opportunities: { count: wantYou, label: `${wantYou} companies want an answer` } } : {}),
    ...(inbox > 0 ? { mail: { count: inbox, label: `${inbox} replies need you` } } : {}),
    ...(queue > 0 ? { queue: { count: queue, label: `${queue} things need you` } } : {}),
  }
}

function initialsOf(user: User): string {
  const src = (user.name || user.email || '').trim()
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
] as const

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Theme">
            <Sun className="size-4 dark:hidden" />
            <Moon className="hidden size-4 dark:block" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={(v) => setTheme(String(v))}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value}>
              <t.icon className="size-4" /> {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ user, side = 'bottom', trigger }: { user: User; side?: 'bottom' | 'top' | 'right'; trigger: React.ReactElement }) {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent side={side} align="end" className="w-60">
        {/* A group label must sit inside a group (Base UI throws error #31 otherwise and the page crashes). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            {user.email ? <span className="block truncate text-xs text-muted-foreground">{user.email}</span> : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={(v) => setTheme(String(v))}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.value} value={t.value}>
                <t.icon className="size-4" /> {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings/account" />}>Account</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings/profile" />}>Profile and CV</DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void logoutAction()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Avatar({ user, className }: { user: User; className?: string }) {
  return <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary-text', className)}>{initialsOf(user)}</span>
}

function CountPill({ count, label, className }: { count: number; label: string; className?: string }) {
  return (
    <span aria-label={label} className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold tabular-nums text-warning-text', className)}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

function SearchButton() {
  const { setOpen } = useCommandMenu()
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground lg:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search className="size-4" />
      </Button>
    </>
  )
}

function TopBarTitle({ pathname }: { pathname: string }) {
  const t = pageTitle(pathname)
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {t.detail && t.href ? (
        <>
          <Link href={t.href} className="truncate text-muted-foreground hover:text-foreground">
            {t.section}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{t.detail}</span>
        </>
      ) : (
        <span className="truncate font-medium">{t.section}</span>
      )}
    </nav>
  )
}

function DesktopSidebar({ pathname, user, counts }: { pathname: string; user: User; counts: ReturnType<typeof useNavCounts> }) {
  return (
    <Sidebar collapsible="icon" className="hidden md:flex">
      <SidebarHeader className="h-[var(--header-height)] justify-center border-b border-sidebar-border px-3 group-data-[collapsible=icon]:px-2">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <LogoMark size={26} />
          <span className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold tracking-tight text-sidebar-accent-foreground">Job Pilot</span>
            <span className="truncate text-[11px] text-muted-foreground">Your job search</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0 py-2">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="h-7 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item.href)
                  const c = counts[item.key]
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={c ? `${item.label} (${c.count})` : item.label}
                        className="h-8 text-[13px] text-sidebar-foreground data-active:font-medium data-active:text-sidebar-accent-foreground data-active:[&_svg]:text-primary"
                        render={<Link href={item.href} aria-current={active ? 'page' : undefined} />}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {c ? (
                        <SidebarMenuBadge className="right-2">
                          <CountPill count={c.count} label={c.label} />
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu
              user={user}
              side="right"
              trigger={
                <SidebarMenuButton size="lg" className="h-11 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0.5!" tooltip="Account">
                  <Avatar user={user} />
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-[13px] font-medium text-sidebar-accent-foreground">{user.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{user.email ?? 'Account'}</span>
                  </span>
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Phone navigation: four destinations and a "More" sheet with everything else. */
function MobileTabBar({ pathname, user, counts }: { pathname: string; user: User; counts: ReturnType<typeof useNavCounts> }) {
  const [more, setMore] = useState(false)
  const { theme, setTheme } = useTheme()
  const tabs = NAV_ITEMS.filter((i) => i.mobile)
  const moreActive = !tabs.some((t) => isActivePath(pathname, t.href))
  const moreCount = NAV_ITEMS.filter((i) => !i.mobile).reduce((n, i) => n + (counts[i.key]?.count ?? 0), 0)
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((item) => {
            const active = isActivePath(pathname, item.href)
            const c = counts[item.key]
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', active ? 'text-primary' : 'text-muted-foreground active:text-foreground')}
                >
                  <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-primary-soft')}>
                    <item.icon className="size-[18px]" />
                  </span>
                  {item.label}
                  {c ? <CountPill count={c.count} label={c.label} className="absolute top-1 left-1/2 ml-2.5 h-4 min-w-4 px-1 text-[10px]" /> : null}
                </Link>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              className={cn('relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium', moreActive ? 'text-primary' : 'text-muted-foreground')}
            >
              <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', moreActive && 'bg-primary-soft')}>
                <Menu className="size-[18px]" />
              </span>
              More
              {moreCount ? <CountPill count={moreCount} label={`${moreCount} waiting`} className="absolute top-1 left-1/2 ml-2.5 h-4 min-w-4 px-1 text-[10px]" /> : null}
            </button>
          </li>
        </ul>
      </nav>
      <Drawer open={more} onOpenChange={setMore}>
        <DrawerContent>
          <DrawerHeader className="flex-row items-center gap-3">
            <Avatar user={user} className="size-9 text-xs" />
            <div className="min-w-0">
              <DrawerTitle className="truncate">{user.name}</DrawerTitle>
              <DrawerDescription className="truncate">{user.email ?? 'Signed in'}</DrawerDescription>
            </div>
          </DrawerHeader>
          <div className="overflow-y-auto px-2 pb-2">
            {NAV_GROUPS.map((g) => (
              <div key={g.label} className="py-1">
                <p className="px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>
                <ul>
                  {g.items.map((item) => {
                    const active = isActivePath(pathname, item.href)
                    const c = counts[item.key]
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMore(false)}
                          aria-current={active ? 'page' : undefined}
                          className={cn('flex h-11 items-center gap-3 rounded-lg px-3 text-sm', active ? 'bg-accent font-medium text-foreground' : 'text-foreground/90 active:bg-accent')}
                        >
                          <item.icon className={cn('size-[18px]', active ? 'text-primary' : 'text-muted-foreground')} />
                          <span className="flex-1">{item.label}</span>
                          {c ? <CountPill count={c.count} label={c.label} /> : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <div className="mt-1 border-t px-3 pt-3">
              <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Theme</p>
              <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {THEMES.map((t) => {
                  const on = (theme ?? 'system') === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setTheme(t.value)}
                      className={cn('flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium', on ? 'bg-background text-foreground shadow-[var(--shadow-card)]' : 'text-muted-foreground')}
                    >
                      <t.icon className="size-3.5" /> {t.label}
                    </button>
                  )
                })}
              </div>
              <Link href="/settings/account" onClick={() => setMore(false)} className="mt-3 flex h-11 w-full items-center gap-3 rounded-lg px-1 text-sm text-foreground/90 active:bg-accent">
                <CircleUserRound className="size-[18px] text-muted-foreground" /> Account
              </Link>
              <button type="button" onClick={() => void logoutAction()} className="flex h-11 w-full items-center gap-3 rounded-lg px-1 text-sm text-danger-text">
                <LogOut className="size-[18px]" /> Sign out
              </button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

/** Sidebar open on wide screens, the icon rail on tablets; the user can still toggle it (Ctrl+B or the button). */
function useSidebarOpenByWidth(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setOpen(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return [open, setOpen]
}

export function AppShell({ children, user }: { children: ReactNode; user: User }) {
  const pathname = usePathname()
  const counts = useNavCounts()
  const [open, setOpen] = useSidebarOpenByWidth()
  return (
    <CommandMenuProvider>
      <SidebarProvider open={open} onOpenChange={setOpen}>
        <DesktopSidebar pathname={pathname} user={user} counts={counts} />
        <SidebarInset className="min-w-0 bg-background">
          <header className="sticky top-0 z-30 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-4 lg:px-6">
            <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
            <Link href="/dashboard" className="flex items-center md:hidden" aria-label="Today">
              <LogoMark size={26} />
            </Link>
            <span aria-hidden className="mx-1 hidden h-4 w-px bg-border md:block" />
            <TopBarTitle pathname={pathname} />
            <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
              <SearchButton />
              <StatusChip />
              <NotificationsBell />
              <span className="hidden md:inline-flex">
                <ThemeMenu />
              </span>
              <span className="md:hidden">
                <UserMenu
                  user={user}
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label="Account">
                      <Avatar user={user} className="size-6 text-[10px]" />
                    </Button>
                  }
                />
              </span>
            </div>
          </header>
          {/* overflow-x-clip: a page that is too wide is cut at the edge instead of widening the phone's layout viewport (which pushed the tab bar off screen). */}
          <main className="min-w-0 flex-1 overflow-x-clip px-3 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 md:pb-10 lg:px-8">
            {/* Pages can opt out of the reading width (e.g. the Kanban board) by rendering an element with data-full-bleed. */}
            <div className="mx-auto w-full max-w-[84rem] has-data-full-bleed:max-w-none">{children}</div>
          </main>
        </SidebarInset>
        <MobileTabBar pathname={pathname} user={user} counts={counts} />
      </SidebarProvider>
    </CommandMenuProvider>
  )
}
