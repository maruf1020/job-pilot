'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { List, SquareKanban } from 'lucide-react'
import { useHydrated } from '@/hooks/use-hydrated'
import { useApiQuery } from '@/lib/api/hooks'
import { Segmented } from '@/components/shared/filter-bar'
import { PageHeader } from '@/components/shared/page-header'
import { ApplicationsBoard } from './applications-board'
import { AutoApplyPanel } from './auto-apply'
import { BrowserApplyPanel } from './browser-auto-apply'
import { FollowUpsDue } from './follow-ups-due'
import { OngoingList, useOngoing } from './ongoing-list'
import { ReadyToSubmit } from './ready-to-submit'
import { ApplicationsTable } from './applications-table'

/** `?view=`: all (table), board, ongoing, ready, followups, drafts. "board" is the All list as a Kanban. */
type View = 'all' | 'board' | 'ongoing' | 'ready' | 'followups' | 'drafts'
type Tab = Exclude<View, 'board'>
const VIEWS: View[] = ['all', 'board', 'ongoing', 'ready', 'followups', 'drafts']
const DRAFT_PARAMS = { 'status[in]': 'DRAFT,REVIEW,NEEDS_HUMAN' }

const DESCRIPTION: Record<View, string> = {
  all: 'Every application, newest activity first.',
  board: 'Drag cards between stages. Search and filter to focus the board.',
  ongoing: 'Companies that replied, interviews and offers, with what to do next.',
  ready: 'Forms the browser agent filled or could not finish.',
  followups: 'Emails with no reply after a week, waiting for your approval.',
  drafts: 'Drafts and applications waiting for your review.',
}

export function ApplicationsView() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = sp.get('view') as View | null
  const view: View = raw && VIEWS.includes(raw) ? raw : 'all'
  const tab: Tab = view === 'board' ? 'all' : view

  // Counts for the tabs, from the same queries the views use (shared cache).
  const ongoing = useOngoing()
  const waiting = useApiQuery<Array<{ id: string }>>(['portal-attempts', 'waiting'], '/api/portal-attempts?status=AWAITING_REVIEW,NEEDS_HUMAN', { refetchInterval: 20_000 })
  const followUps = useApiQuery<Array<{ approved: boolean }>>(['follow-ups'], '/api/follow-ups', { refetchInterval: 60_000 })
  // Counts may already be cached by Today or the shell when this boundary hydrates: show them after.
  const hydrated = useHydrated()

  const setView = (next: View) => {
    if (next === view) return
    const params = new URLSearchParams()
    // Table filters belong to the list they were set on; a new view starts clean.
    if (next !== 'all') params.set('view', next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const layoutSwitch =
    tab === 'all' ? (
      <Segmented<'all' | 'board'>
        value={view === 'board' ? 'board' : 'all'}
        onChange={(v) => setView(v)}
        options={[
          {
            value: 'all',
            label: (
              <>
                <List className="size-3.5" /> Table
              </>
            ),
          },
          {
            value: 'board',
            label: (
              <>
                <SquareKanban className="size-3.5" /> Board
              </>
            ),
          },
        ]}
      />
    ) : null

  return (
    // The board uses the whole main area (no reading width), like a project-management board.
    <div className="flex flex-col gap-6" data-full-bleed={view === 'board' ? '' : undefined}>
      <PageHeader
        title="Applications"
        description={DESCRIPTION[view]}
        actions={
          <>
            <BrowserApplyPanel part="controls" />
            <AutoApplyPanel part="controls" />
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<Tab>
            value={tab}
            onChange={(t) => setView(t)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ongoing', label: 'Ongoing', count: hydrated ? ongoing.data?.data.length : undefined },
              { value: 'ready', label: 'Ready to submit', count: hydrated ? waiting.data?.data.length : undefined },
              { value: 'followups', label: 'Follow-ups due', count: hydrated && followUps.data ? followUps.data.data.filter((r) => !r.approved).length : undefined },
              { value: 'drafts', label: 'Drafts' },
            ]}
          />
          {layoutSwitch}
        </div>
      </PageHeader>

      {/* Running batches: one compact strip each (they used to be two large cards). */}
      <div className="flex flex-col gap-2 empty:hidden">
        <BrowserApplyPanel part="status" />
        <AutoApplyPanel part="status" />
      </div>

      {view === 'board' ? (
        <ApplicationsBoard />
      ) : view === 'ongoing' ? (
        <OngoingList title="Ongoing" />
      ) : view === 'ready' ? (
        <ReadyToSubmit showEmpty />
      ) : view === 'followups' ? (
        <FollowUpsDue showEmpty />
      ) : view === 'drafts' ? (
        <ApplicationsTable extraParams={DRAFT_PARAMS} emptyTitle="No drafts waiting" emptyDescription="Drafts and applications held for your review show up here." />
      ) : (
        <ApplicationsTable />
      )}
    </div>
  )
}
