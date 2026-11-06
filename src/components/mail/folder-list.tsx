'use client'

import type { ReactNode } from 'react'
import { AlarmClock, Eye, FileEdit, MailQuestion, Reply, Send, ShieldAlert, Star } from 'lucide-react'
import { FOLDER_META, MAIL_FOLDERS, type MailFolder } from '@/lib/mail/folders'
import { cn } from '@/lib/utils'

const ICON: Record<MailFolder, ReactNode> = {
  'needs-answer': <MailQuestion />,
  important: <Star />,
  replied: <Reply />,
  sent: <Send />,
  'needs-review': <Eye />,
  drafts: <FileEdit />,
  waiting: <AlarmClock />,
  held: <ShieldAlert />,
}

/** Folders that ask something of you get a stronger count. */
const URGENT = new Set<MailFolder>(['needs-answer', 'needs-review'])

const GROUPS: Array<{ label: string; folders: MailFolder[] }> = [
  { label: 'Replies', folders: ['needs-answer', 'important', 'replied'] },
  { label: 'Outgoing', folders: ['sent', 'needs-review', 'drafts'] },
  { label: 'On hold', folders: ['waiting', 'held'] },
]

export interface ExtraView {
  key: string
  label: string
  icon: ReactNode
}

/** Left column: the folders with counts (a scrolling chip row on phones) and the older inbox views below them. */
export function FolderList({
  folder,
  counts,
  onSelect,
  extras,
  extra,
  onSelectExtra,
}: {
  folder: MailFolder
  counts: Record<MailFolder, number> | undefined
  onSelect: (f: MailFolder) => void
  extras: ExtraView[]
  extra: string | null
  onSelectExtra: (key: string) => void
}) {
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    on: boolean,
    count: number | undefined,
    urgent: boolean,
    click: () => void,
    title?: string,
  ) => (
    <button
      key={key}
      type="button"
      onClick={click}
      title={title}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm whitespace-nowrap transition-colors lg:w-full [&_svg]:size-4 [&_svg]:shrink-0',
        on
          ? 'bg-primary-soft text-primary-text font-medium'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count != null ? (
        <span
          className={cn(
            'text-xs tabular-nums',
            !on && urgent && count > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
  return (
    <nav
      aria-label="Mail folders"
      className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0"
    >
      {GROUPS.map((g) => (
        <div key={g.label} className="flex gap-1 lg:flex-col">
          <p className="text-muted-foreground hidden px-2.5 pb-0.5 text-[11px] font-medium tracking-wide uppercase lg:block">
            {g.label}
          </p>
          {g.folders
            .filter((f) => MAIL_FOLDERS.includes(f))
            .map((f) =>
              item(
                f,
                FOLDER_META[f].label,
                ICON[f],
                !extra && folder === f,
                counts?.[f],
                URGENT.has(f),
                () => onSelect(f),
                FOLDER_META[f].description,
              ),
            )}
        </div>
      ))}
      <div className="flex gap-1 lg:flex-col">
        <p className="text-muted-foreground hidden px-2.5 pb-0.5 text-[11px] font-medium tracking-wide uppercase lg:block">
          More views
        </p>
        {extras.map((e) =>
          item(e.key, e.label, e.icon, extra === e.key, undefined, false, () => onSelectExtra(e.key)),
        )}
      </div>
    </nav>
  )
}
