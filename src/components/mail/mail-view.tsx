'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, ChevronLeft, ChevronRight, Globe2, Inbox, Rocket, TimerReset } from 'lucide-react'
import { InboxView } from '@/components/inbox/inbox-view'
import { SyncButton } from '@/components/inbox/sync-button'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { useApiQuery } from '@/lib/api/hooks'
import { FOLDER_META, MAIL_FOLDERS, type MailFolder } from '@/lib/mail/folders'
import type { MailList } from '@/lib/mail/types'
import { cn } from '@/lib/utils'
import { FolderList, type ExtraView } from './folder-list'
import { LoopsCard } from './loops-card'
import { MailReader } from './mail-reader'
import { MessageList } from './message-list'

const DEFAULT_FOLDER: MailFolder = 'needs-answer'
const PAGE_SIZE = 40

/** The classic inbox views that live under "More views" (their tab names in InboxView). */
const EXTRAS: Array<ExtraView & { tab: string }> = [
  { key: 'nudges', tab: 'needs', label: 'Nudges and processes', icon: <TimerReset /> },
  { key: 'next-steps', tab: 'next-steps', label: 'Next steps', icon: <Rocket /> },
  { key: 'not-hiring-abroad', tab: 'not-hiring-abroad', label: 'Not hiring abroad', icon: <Globe2 /> },
  { key: 'all', tab: 'all', label: 'All replies', icon: <BarChart3 /> },
]
/** Short names that older links (/inbox?tab=next) used. */
const TAB_ALIASES: Record<string, string> = {
  next: 'next-steps',
  abroad: 'not-hiring-abroad',
  replies: 'all',
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
      <Button size="xs" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft /> Newer
      </Button>
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <Button size="xs" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Older <ChevronRight />
      </Button>
    </div>
  )
}

/**
 * Mail (docs/MAIL_PLAN.md): folders on the left, the messages of the folder in the middle, the reader on the
 * right. State lives in the URL: ?folder=, ?id= (application), ?page=, and ?tab= for the classic inbox views.
 */
export function MailView() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const rawTab = sp.get('tab')
  const tab = rawTab ? (TAB_ALIASES[rawTab] ?? rawTab) : null
  const extra = tab ? (EXTRAS.find((e) => e.tab === tab) ?? null) : null
  const rawFolder = sp.get('folder') as MailFolder | null
  const folder: MailFolder = rawFolder && MAIL_FOLDERS.includes(rawFolder) ? rawFolder : DEFAULT_FOLDER
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
  const selectedId = sp.get('id')

  /** Change the URL state; keys not named stay, except filters of the classic views, which are dropped. */
  const go = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams()
    for (const k of ['folder', 'page', 'id']) if (!extra && sp.get(k)) params.set(k, sp.get(k)!)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k)
      else params.set(k, v)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const q = useApiQuery<MailList>(['inbox', 'mail'], `/api/mail?folder=${folder}&page=${page}`, {
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
  const data = q.data?.data
  const counts = data?.counts
  const meta = FOLDER_META[folder]
  const needsCount = counts ? counts['needs-answer'] : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Mail"
        description={
          needsCount === null
            ? 'Every application email, in folders.'
            : needsCount
              ? `${needsCount} ${needsCount === 1 ? 'reply needs' : 'replies need'} an answer. Answer every reply the same day.`
              : 'Every reply is answered.'
        }
        meta={
          counts ? (
            <span>
              {counts.sent} sent · {counts.replied} replied · {counts.waiting} waiting for a cooldown ·{' '}
              {counts.held} held
            </span>
          ) : null
        }
        actions={<SyncButton showLast />}
      />
      <LoopsCard />
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <FolderList
          folder={folder}
          counts={counts}
          onSelect={(f) => go({ folder: f, page: null, id: null, tab: null })}
          extras={EXTRAS}
          extra={extra?.key ?? null}
          onSelectExtra={(key) =>
            go({ tab: EXTRAS.find((e) => e.key === key)?.tab ?? null, folder: null, page: null, id: null })
          }
        />
        {extra ? (
          <div className="min-w-0">
            <InboxView embedded />
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 lg:h-[calc(100dvh-21rem)] lg:min-h-[30rem] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <section
              className={cn(
                'bg-card flex min-h-0 flex-col overflow-hidden rounded-lg border',
                selectedId && 'max-lg:hidden',
              )}
              aria-label={meta.label}
            >
              <header className="border-b px-3 py-2">
                <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
                  {meta.label}
                  {counts ? (
                    <span className="bg-muted text-muted-foreground rounded-md px-1.5 text-xs font-medium tabular-nums">
                      {counts[folder]}
                    </span>
                  ) : null}
                </h2>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{meta.description}</p>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {!data ? (
                  q.isError ? (
                    <EmptyState
                      compact
                      className="m-3"
                      title="Could not load the mail"
                      description={q.error.message}
                    />
                  ) : (
                    <SectionSkeleton />
                  )
                ) : data.items.length ? (
                  <MessageList
                    items={data.items}
                    folder={folder}
                    selectedId={selectedId}
                    onSelect={(id) => go({ id })}
                  />
                ) : (
                  <EmptyState
                    compact
                    className="m-3"
                    icon={<Inbox />}
                    title={`Nothing in ${meta.label}`}
                    description="New mail lands here after the next check."
                  />
                )}
              </div>
              {counts ? (
                <Pager page={page} total={counts[folder]} onPage={(p) => go({ page: String(p), id: null })} />
              ) : null}
            </section>
            <section
              className={cn(
                'bg-card min-h-0 overflow-y-auto rounded-lg border p-4',
                !selectedId && 'max-lg:hidden',
              )}
              aria-label="Reader"
            >
              <MailReader applicationId={selectedId} onBack={() => go({ id: null })} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
