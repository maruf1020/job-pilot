'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronsUpDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { countryOptions, timezoneOptions } from './countries'

export interface PickOption {
  value: string
  label: string
  /** Shown before the label (a flag). */
  icon?: string
  /** Extra words the search matches. */
  keywords?: string[]
}

/** A searchable single choice (long lists: countries, time zones). */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choose',
  searchPlaceholder = 'Search',
  emptyText = 'Nothing found',
  allowClear,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: PickOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  allowClear?: boolean
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            className={cn('h-8 w-full justify-between px-2.5 font-normal', !selected && 'text-muted-foreground', className)}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {selected?.icon ? <span aria-hidden>{selected.icon}</span> : null}
          <span className="truncate">{selected?.label ?? (value || placeholder)}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {allowClear && value ? (
              <CommandItem
                value="__clear"
                onSelect={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="text-muted-foreground"
              >
                Clear
              </CommandItem>
            ) : null}
            {options.map((o) => (
              <CommandItem
                key={o.value}
                value={`${o.label} ${o.value} ${(o.keywords ?? []).join(' ')}`}
                data-checked={o.value === value}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                {o.icon ? <span aria-hidden>{o.icon}</span> : null}
                <span className="truncate">{o.label}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function useCountryOptions(only?: string[]): PickOption[] {
  return useMemo(() => {
    const all = countryOptions().map((c) => ({ value: c.value, label: c.label, icon: c.flag }))
    return only ? all.filter((c) => only.includes(c.value)) : all
  }, [only])
}

export function CountrySelect(props: { id?: string; value: string; onChange: (value: string) => void; allowClear?: boolean; 'aria-describedby'?: string }) {
  const options = useCountryOptions()
  return <SearchSelect {...props} options={options} placeholder="Choose a country" searchPlaceholder="Search countries" emptyText="No country with that name" />
}

/** Chips for the chosen countries plus a searchable "Add" list. */
export function CountryMultiSelect({ id, value, onChange, addLabel = 'Add a country', only, max = 40 }: { id?: string; value: string[]; onChange: (next: string[]) => void; addLabel?: string; only?: string[]; max?: number }) {
  const options = useCountryOptions(only)
  const [open, setOpen] = useState(false)
  const byCode = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
  const remaining = options.filter((o) => !value.includes(o.value))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((code) => (
        <span key={code} className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-secondary pr-0.5 pl-2 text-xs font-medium text-secondary-foreground">
          <span aria-hidden>{byCode.get(code)?.icon}</span>
          <span className="truncate">{byCode.get(code)?.label ?? code}</span>
          <button
            type="button"
            aria-label={`Remove ${byCode.get(code)?.label ?? code}`}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onChange(value.filter((c) => c !== code))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {value.length < max ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button id={id} type="button" variant="outline" size="sm" className="h-7" />}>
            <Plus className="size-3.5" /> {addLabel}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-0">
            <Command>
              <CommandInput placeholder="Search countries" />
              <CommandList>
                <CommandEmpty>No country with that name</CommandEmpty>
                {remaining.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.value}`}
                    onSelect={() => {
                      onChange([...value, o.value])
                      setOpen(false)
                    }}
                  >
                    <span aria-hidden>{o.icon}</span>
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

export function TimezoneSelect(props: { id?: string; value: string; onChange: (value: string) => void }) {
  const options = useMemo(() => timezoneOptions().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [])
  return <SearchSelect {...props} options={options} placeholder="Choose a time zone" searchPlaceholder="Search, e.g. Lisbon" emptyText="No time zone with that name" />
}

/** A short list as a dropdown; '' is a real option when `emptyLabel` is given. */
export function OptionSelect({
  id,
  value,
  onChange,
  options,
  emptyLabel,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  emptyLabel?: string
  className?: string
  'aria-label'?: string
}) {
  // base-ui Select treats '' as "nothing chosen", so the empty answer travels as a sentinel.
  const EMPTY = '__empty'
  const items = [...(emptyLabel ? [{ value: EMPTY, label: emptyLabel }] : []), ...options]
  return (
    <Select
      value={value === '' && emptyLabel ? EMPTY : value}
      onValueChange={(v) => {
        const next = String(v ?? '')
        onChange(next === EMPTY ? '' : next)
      }}
      items={items}
    >
      <SelectTrigger id={id} className={cn('w-full', className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value}>
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A small set of exclusive answers as pill buttons (native radios underneath, so arrow keys and
 * screen readers work as usual).
 */
export function ChoiceGroup<T extends string>({
  legend,
  help,
  name,
  value,
  onChange,
  options,
  required,
}: {
  legend: ReactNode
  help?: ReactNode
  name: string
  value: T | ''
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string; help?: string }>
  required?: boolean
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">
        {legend}
        {required ? <RequiredMark /> : null}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o.value} className="relative cursor-pointer">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
            <span className="inline-flex min-h-8 items-center rounded-lg border bg-background px-3 py-1 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:border-border-strong">
              {o.label}
            </span>
          </label>
        ))}
      </div>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </fieldset>
  )
}

/** Several answers from a short list as toggle pills. */
export function MultiChoice({ legend, help, value, onChange, options }: { legend: ReactNode; help?: ReactNode; value: string[]; onChange: (next: string[]) => void; options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm leading-none font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value)
          return (
            <label key={o.value} className="relative cursor-pointer">
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])} className="peer sr-only" />
              <span className="inline-flex min-h-8 items-center rounded-lg border bg-background px-3 py-1 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary-soft peer-checked:text-primary-text peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:border-border-strong">
                {o.label}
              </span>
            </label>
          )
        })}
      </div>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </fieldset>
  )
}

export function RequiredMark() {
  return (
    <span className="ml-1 text-danger-text" aria-hidden title="Needed to finish">
      *
    </span>
  )
}
