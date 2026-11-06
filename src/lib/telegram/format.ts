import { env } from '@/lib/env'

/** Characters Telegram MarkdownV2 wants escaped in plain text. */
const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g

export function escapeMarkdownV2(text: string): string {
  return text.replace(MDV2_SPECIAL, (c) => `\\${c}`)
}

/**
 * Handlers write plain text with two light markers: **bold** and `code`. Everything else is escaped,
 * so a company called "A_B (x)" or a URL never breaks the message.
 */
export function lightMarkdownToV2(text: string): string {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return `*${escapeMarkdownV2(part.slice(2, -2))}*`
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return `\`${part.slice(1, -1).replace(/[\\`]/g, (c) => `\\${c}`)}\``
      return escapeMarkdownV2(part)
    })
    .join('')
}

/** The same text without the markers, for the plain-text retry. */
export function stripLightMarkdown(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1')
}

export const TELEGRAM_MAX = 3800

/** Splits a long message on line breaks so every part fits one Telegram message. */
export function splitMessage(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (line.length > max) {
      if (current) parts.push(current)
      current = ''
      for (let i = 0; i < line.length; i += max) parts.push(line.slice(i, i + max))
      continue
    }
    if (current.length + line.length + 1 > max) {
      parts.push(current)
      current = line
    } else current = current ? `${current}\n${line}` : line
  }
  if (current) parts.push(current)
  return parts
}

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, Math.max(0, max - 3)).trimEnd()}...` : t
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A link into the app (APP_URL), or the URL itself when it is absolute. */
export function appLink(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${env.APP_URL.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
}

/** "5 min ago", "3 h ago", "2 d ago". */
export function ago(date: Date | null | undefined, now = new Date()): string {
  if (!date) return 'never'
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000))
  if (s < 90) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** First line of an error, at most 200 characters: never a stack trace. */
export function oneLineError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return truncate(raw.split('\n')[0] ?? 'unknown error', 200)
}
