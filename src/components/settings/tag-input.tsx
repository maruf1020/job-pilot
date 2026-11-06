'use client'

import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
  className?: string
  disabled?: boolean
  /** Clean up / validate a raw token before it is added. Return null to reject it. */
  normalize?: (raw: string) => string | null
  /** Custom chip content (defaults to the tag text). */
  renderTag?: (tag: string) => ReactNode
  'aria-label'?: string
}

const SPLIT_RE = /[,\n]/

/** Chips + inline input. Enter or comma adds, Backspace on an empty input removes the last chip, paste splits on commas/newlines. */
export function TagInput({ value, onChange, placeholder, id, className, disabled, normalize, renderTag, ...aria }: TagInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTokens = (raw: string) => {
    const tokens = raw
      .split(SPLIT_RE)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length === 0) return
    const next = [...value]
    for (const token of tokens) {
      const clean = normalize ? normalize(token) : token
      if (!clean || next.includes(clean)) continue
      next.push(clean)
    }
    if (next.length !== value.length) onChange(next)
  }

  const commit = () => {
    if (text.trim()) addTokens(text)
    setText('')
  }

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      e.preventDefault()
      remove(value.length - 1)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text')
    if (!SPLIT_RE.test(pasted)) return
    e.preventDefault()
    addTokens(`${text}${pasted}`)
    setText('')
  }

  return (
    <div
      className={cn(
        'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag, i) => (
        <span key={`${tag}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
          <span className="truncate">{renderTag ? renderTag(tag) : tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="-mr-0.5 rounded-sm p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              remove(i)
            }}
            disabled={disabled}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={commit}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={aria['aria-label']}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
