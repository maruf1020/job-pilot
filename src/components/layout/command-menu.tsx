'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Briefcase, Building2, Laptop, Moon, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useDebouncedValue } from '@/hooks/use-debounce'
import { useApiQuery } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { NAV_GROUPS, SETTINGS_TABS } from './nav'

interface Ctx {
  open: boolean
  setOpen: (open: boolean) => void
}

const CommandMenuContext = createContext<Ctx>({ open: false, setOpen: () => undefined })

/** Opens the command menu from anywhere (top bar button, mobile search icon). */
export function useCommandMenu() {
  return useContext(CommandMenuContext)
}

interface JobHit {
  id: string
  title: string
  companyName: string
  countryCode: string | null
  score: { finalScore: number | null } | null
}
interface CompanyHit {
  id: string
  name: string
  countryCode: string | null
  _count?: { jobs: number }
}

/** Ctrl+K / Cmd+K: jump to any page, search jobs and companies, switch the theme. */
export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const value = useMemo(() => ({ open, setOpen }), [open])
  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      <CommandMenu open={open} setOpen={setOpen} />
    </CommandMenuContext.Provider>
  )
}

const THEME_ITEMS = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Laptop],
] as const

function CommandMenu({ open, setOpen }: Ctx) {
  const router = useRouter()
  const { setTheme } = useTheme()
  const [term, setTerm] = useState('')
  const q = useDebouncedValue(term.trim(), 250)
  const searching = open && q.length >= 2
  const jobs = useApiQuery<JobHit[]>(
    ['cmdk', 'jobs'],
    searching ? `/api/jobs?q=${encodeURIComponent(q)}&pageSize=6` : null,
  )
  const companies = useApiQuery<CompanyHit[]>(
    ['cmdk', 'companies'],
    searching ? `/api/companies?q=${encodeURIComponent(q)}&pageSize=5` : null,
  )

  // cmdk's own ranking re-ordered the API results (a junk company outranked the best job): filter pages
  // with a plain substring match and keep the server's order for jobs and companies.
  const needle = term.trim().toLowerCase()
  const match = (...texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle))

  const settingsHits = SETTINGS_TABS.filter((t) => t.href !== '/settings' && match(`settings ${t.label}`))
  const themeHits = THEME_ITEMS.filter(([, label]) => match(`theme ${label}`))

  // Keep the highlight on the first row in display order; results arrive after typing, and an
  // uncontrolled cmdk kept a stale highlight (Enter then opened the wrong row).
  const jobRows = searching ? (jobs.data?.data ?? []) : []
  const companyRows = searching ? (companies.data?.data ?? []) : []
  const navHits = NAV_GROUPS.flatMap((g) => g.items).filter((i) => match(i.label, ...(i.keywords ?? [])))
  const first = jobRows[0]
    ? `job ${jobRows[0].title} ${jobRows[0].companyName} ${jobRows[0].id}`
    : companyRows[0]
      ? `company ${companyRows[0].name} ${companyRows[0].id}`
      : navHits[0]
        ? `${navHits[0].label} ${(navHits[0].keywords ?? []).join(' ')}`
        : settingsHits[0]
          ? `settings ${settingsHits[0].label}`
          : themeHits[0]
            ? `theme ${themeHits[0][1]}`
            : ''
  const [selected, setSelected] = useState('')
  const [shownFirst, setShownFirst] = useState('')
  if (first !== shownFirst) {
    setShownFirst(first)
    setSelected(first)
  }

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      setTerm('')
      router.push(href)
    },
    [router, setOpen],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setTerm('')
      }}
      title="Command menu"
      description="Jump to a page or search jobs and companies"
      className="sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        className="rounded-none! bg-transparent p-0"
      >
        <CommandInput placeholder="Search pages, jobs, companies…" value={term} onValueChange={setTerm} />
        <CommandList className="max-h-[min(60dvh,26rem)]">
          <CommandEmpty>
            {searching && (jobs.isFetching || companies.isFetching) ? 'Searching…' : 'No results.'}
          </CommandEmpty>
          {searching && (jobs.data?.data.length ?? 0) > 0 ? (
            <CommandGroup heading="Jobs">
              {jobs.data!.data.map((j) => (
                <CommandItem
                  key={j.id}
                  value={`job ${j.title} ${j.companyName} ${j.id}`}
                  onSelect={() => go(`/jobs/${j.id}`)}
                >
                  <Briefcase className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {j.title} <span className="text-muted-foreground">at {j.companyName}</span>
                  </span>
                  {j.score?.finalScore != null ? (
                    <CommandShortcut className="tracking-normal tabular-nums">
                      {j.score.finalScore}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {searching && (companies.data?.data.length ?? 0) > 0 ? (
            <CommandGroup heading="Companies">
              {companies.data!.data.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`company ${c.name} ${c.id}`}
                  onSelect={() => go(`/companies/${c.id}`)}
                >
                  <Building2 className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c._count ? (
                    <CommandShortcut className="tracking-normal tabular-nums">
                      {c._count.jobs} jobs
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {NAV_GROUPS.filter((g) => g.items.some((i) => match(i.label, ...(i.keywords ?? [])))).map((g) => (
            <CommandGroup key={g.label} heading={g.label}>
              {g.items
                .filter((i) => match(i.label, ...(i.keywords ?? [])))
                .map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${(item.keywords ?? []).join(' ')}`}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon className="text-muted-foreground" />
                    {item.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
          {settingsHits.length ? (
            <CommandGroup heading="Settings">
              {settingsHits.map((t) => (
                <CommandItem key={t.href} value={`settings ${t.label}`} onSelect={() => go(t.href)}>
                  <Search className="text-muted-foreground" />
                  Settings: {t.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {themeHits.length ? <CommandSeparator /> : null}
          {themeHits.length ? (
            <CommandGroup heading="Theme">
              {themeHits.map(([value, label, Icon]) => (
                <CommandItem
                  key={value}
                  value={`theme ${label}`}
                  onSelect={() => {
                    setTheme(value)
                    setOpen(false)
                  }}
                >
                  <Icon className="text-muted-foreground" />
                  {label} theme
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
      <div className="text-muted-foreground hidden items-center gap-3 border-t px-3 py-2 text-[11px] sm:flex">
        <Kbd>↑↓</Kbd> to move <Kbd>Enter</Kbd> to open <Kbd>Esc</Kbd> to close
      </div>
    </CommandDialog>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[10px] font-medium',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
