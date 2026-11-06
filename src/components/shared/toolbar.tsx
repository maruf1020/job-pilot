'use client'

import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/** Row above a list: search on the left, filters and actions on the right; wraps on phones. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
}

export function ToolbarSpacer() {
  return <div className="flex-1" />
}

/** Search input with an icon and a clear button. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pr-8 pl-8" aria-label={placeholder.replace(/…$/, '')} autoFocus={autoFocus} />
      {value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
