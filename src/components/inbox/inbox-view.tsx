'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Inbox, Reply, Rocket } from 'lucide-react'
import { useHydrated } from '@/hooks/use-hydrated'
import { useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo } from '@/lib/format'
import { buttonVariants } from '@/components/ui/button'
import { Segmented } from '@/components/shared/filter-bar'
import { EmptyState, PageHeader } from '@/components/shared/page-header'
import { ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { ActiveProcessesPanel } from './active-processes'
import { InboxTable } from './inbox-table'
import { NotHiringAbroadPanel, useNotHiringAbroad } from './not-hiring-abroad'
import { ReplyRow } from './reply-row'
import { SyncButton } from './sync-button'
import type { NeedsActionData, WaitingItem } from './types'

type Tab = 'needs' | 'next-steps' | 'not-hiring-abroad' | 'all'
const TABS: Tab[] = ['needs', 'next-steps', 'not-hiring-abroad', 'all']
/** Short names that older links used. */
const ALIASES: Record<string, Tab> = { next: 'next-steps', abroad: 'not-hiring-abroad', replies: 'all' }

function useNeedsAction() {
  return useApiQuery<NeedsActionData>(['inbox', 'needs-action'], '/api/inbox/needs-action', { refetchInterval: 30_000 })
}

function WaitingList({ items }: { items: WaitingItem[] }) {
  if (!items.length) return null
  return (
    <Section title="Waiting for them" count={items.length} description="You replied and nothing came back for 4+ days. A short, polite nudge is fine after a week." contentClassName="p-0">
      <ListRows>
        {items.map((w) => (
          <li key={w.applicationId} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
            <Link href={`/applications/${w.applicationId}`} className="min-w-0 flex-1 truncate font-medium hover:underline" title={`${w.job.companyName} · ${w.job.title}`}>
              {flagEmoji(w.job.countryCode)} {w.job.companyName} <span className="font-normal text-muted-foreground">· {w.job.title}</span>
            </Link>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {w.ageDays} day{w.ageDays === 1 ? '' : 's'} quiet · {w.to}
            </span>
            <Link href={`/applications/${w.applicationId}#reply`} className={buttonVariants({ size: 'xs', variant: 'outline' })}>
              <Reply /> Nudge
            </Link>
          </li>
        ))}
      </ListRows>
    </Section>
  )
}

function NeedsYouTab({ data }: { data: NeedsActionData }) {
  return (
    <div className="flex flex-col gap-6">
      <Section title="Needs your answer" count={data.needsYou.length} description="Replies nobody answered yet, most important first: interviews and questions before “apply on our site”." contentClassName="p-0">
        {data.needsYou.length ? (
          <ListRows>
            {data.needsYou.map((it) => (
              <ReplyRow key={it.messageId} it={it} kind="needs" />
            ))}
          </ListRows>
        ) : (
          <EmptyState compact icon={<Inbox />} title="Every reply is answered" description="New replies land here after the next Gmail check (every 30 minutes, or press Sync)." className="m-4" />
        )}
      </Section>
      <WaitingList items={data.waitingForThem} />
      <ActiveProcessesPanel />
    </div>
  )
}

function NextStepsTab({ data }: { data: NeedsActionData }) {
  const open = data.nextSteps.filter((i) => !i.answered).length
  return (
    <Section
      title="Next steps from companies"
      count={data.nextSteps.length}
      description={`Interview requests, interest and requests for details${open ? `; ${open} waiting for your answer` : ''}. Answered ones stay here until their next reply.`}
      contentClassName="p-0"
    >
      {data.nextSteps.length ? (
        <ListRows>
          {data.nextSteps.map((it) => (
            <ReplyRow key={it.messageId} it={it} kind="lead" />
          ))}
        </ListRows>
      ) : (
        <EmptyState compact icon={<Rocket />} title="No next steps yet" description="When a company asks for an interview, shows interest or asks for details, it shows up here." className="m-4" />
      )}
    </Section>
  )
}

/**
 * The classic inbox views (plan-ui-redesign.md 6, group B): needs you, next steps, not hiring from abroad, all
 * replies. Tabs live in the URL (?tab=). `embedded` runs it inside the Mail page, which picks the tab from its
 * own folder list and shows no header of its own.
 */
export function InboxView({ embedded = false }: { embedded?: boolean }) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = sp.get('tab')
  const tab: Tab = raw && TABS.includes(raw as Tab) ? (raw as Tab) : raw && ALIASES[raw] ? ALIASES[raw] : 'needs'
  const q = useNeedsAction()
  const abroad = useNotHiringAbroad()
  // The shell may have cached these already when this boundary hydrates: wait, or the HTML differs.
  const hydrated = useHydrated()
  const data = hydrated ? q.data?.data : undefined
  const setTab = (t: Tab) => {
    const params = new URLSearchParams(sp.toString())
    if (t === 'needs' && !embedded) params.delete('tab')
    else params.set('tab', t)
    // The All replies table keeps its own filters in the URL; leaving it drops them.
    if (t !== 'all') for (const k of [...params.keys()]) if (k !== 'tab') params.delete(k)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const needs = data?.needsYou.length ?? null
  const next = data ? data.nextSteps.filter((i) => !i.answered).length : null
  const abroadCount = hydrated && abroad.data?.data ? abroad.data.data.replies.filter((r) => !r.replied).length : undefined

  return (
    <div className="flex flex-col gap-6">
      {embedded ? null : (
        <PageHeader
          title="Inbox"
          description={needs === null ? 'Replies to your applications.' : needs ? `${needs} ${needs === 1 ? 'reply needs' : 'replies need'} an answer. Answer every reply the same day.` : 'Every reply is answered.'}
          meta={data ? <span>{data.nextSteps.length} next steps · {data.waitingForThem.length} waiting for them</span> : null}
          actions={<SyncButton showLast />}
        >
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'needs', label: 'Needs you', count: needs ?? undefined },
              { value: 'next-steps', label: 'Next steps', count: next ?? undefined },
              { value: 'not-hiring-abroad', label: 'Not hiring from abroad', count: abroadCount },
              { value: 'all', label: 'All replies' },
            ]}
          />
        </PageHeader>
      )}
      {tab === 'all' ? (
        <InboxTable />
      ) : tab === 'not-hiring-abroad' ? (
        <NotHiringAbroadPanel />
      ) : !data ? (
        q.isError ? <EmptyState title="Could not load the inbox" description={q.error.message} /> : <SectionSkeleton />
      ) : tab === 'next-steps' ? (
        <NextStepsTab data={data} />
      ) : (
        <NeedsYouTab data={data} />
      )}
      {data && tab === 'needs' && data.needsYou.length === 0 && data.nextSteps.length ? (
        <p className="text-xs text-muted-foreground">
          Last reply {fmtAgo(data.nextSteps[0].receivedAt)}.{' '}
          <button type="button" className="font-medium text-primary-text hover:underline" onClick={() => setTab('next-steps')}>
            See next steps
          </button>
        </p>
      ) : null}
    </div>
  )
}
