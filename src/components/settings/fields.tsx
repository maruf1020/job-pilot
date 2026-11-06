'use client'

import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * One topic of a settings page (plan-ui-redesign.md 4.2): the same surface as the shared Section,
 * a header row with the title, a one-line explanation and an optional action, then the fields.
 */
export function SectionCard({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-lg border bg-card shadow-[var(--shadow-card)]', className)}>
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  )
}

/** Label + control + optional help line. */
export function Field({ label, htmlFor, help, children, className }: { label: ReactNode; htmlFor?: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  )
}

/** A row with a label/description on the left and a Switch on the right. */
export function SwitchRow({ label, help, checked, onCheckedChange, disabled, className }: { label: ReactNode; help?: ReactNode; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; className?: string }) {
  const id = useId()
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-md border bg-background px-3 py-2.5 transition-colors hover:border-border-strong', className)}>
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        {help ? <p className="mt-1 text-xs text-muted-foreground">{help}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(c) => onCheckedChange(c)} disabled={disabled} className="mt-0.5 shrink-0" />
    </div>
  )
}

export interface NumberInputProps extends Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> {
  value: number
  onValueChange: (next: number) => void
  /** Emit integers only (rounds while typing). */
  integer?: boolean
}

/**
 * Number input that tolerates intermediate states ("", "-", "1.") while typing and only
 * emits finite numbers. Resets to the last good value on blur if the text is invalid.
 */
export function NumberInput({ value, onValueChange, integer, min, max, step, className, ...rest }: NumberInputProps) {
  const [text, setText] = useState(String(value))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (Number(text) !== value) setText(String(value))
  }
  return (
    <Input
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      min={min}
      max={max}
      step={step ?? (integer ? 1 : 'any')}
      className={cn('tabular-nums', className)}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        if (!Number.isFinite(n)) return
        onValueChange(integer ? Math.round(n) : n)
      }}
      onBlur={() => {
        if (text.trim() === '' || !Number.isFinite(Number(text))) setText(String(value))
      }}
      {...rest}
    />
  )
}

/** Small inline hint block. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground', className)}>{children}</div>
}
