'use client'

import { CalendarClock, CircleCheck, Loader } from 'lucide-react'
import { ListRow, ListRows, Section } from '@/components/shared/section'
import { SectionSkeleton } from '@/components/shared/skeletons'
import { AppStatusBadge, ChannelBadge, ReplyBadge } from '@/components/shared/status-badge'
import type { CompanyHistory } from '@/lib/companies/history'
import { useApiQuery } from '@/lib/api/hooks'
import { flagEmoji, fmtAgo, fmtDate } from '@/lib/format'

const VIA_LABEL: Record<string, string> = { agent: 'by the agent', manual: 'by hand', email: 'by email' }

/** The company rule in one line: when the next application to this company is possible. */
function RuleLine({ rule, lastSentAt }: { rule: CompanyHistory['rule']; lastSentAt: string | null }) {
  const limit = `${rule.maxPerCompany === 1 ? 'one application' : `${rule.maxPerCompany} applications`} per company per ${rule.windowDays} days`
  if (rule.inProgress)
    return (
      <p className="flex items-start gap-2 text-sm text-info-text">
        <Loader className="mt-0.5 size-4 shrink-0" /> An application is in progress right now ({limit}).
      </p>
    )
  if (rule.availableAt)
    return (
      <p className="flex items-start gap-2 text-sm text-warning-text">
        <CalendarClock className="mt-0.5 size-4 shrink-0" />
        <span>
          Next application possible from <span className="font-medium">{fmtDate(rule.availableAt)}</span> ({limit}).
        </span>
      </p>
    )
  return (
    <p className="flex items-start gap-2 text-sm text-success-text">
      <CircleCheck className="mt-0.5 size-4 shrink-0" />
      <span>
        Open to a new application ({limit}){lastSentAt ? `; last applied ${fmtAgo(lastSentAt)}` : ''}.
      </span>
    </p>
  )
}

/** Every application to this company, newest first, with the reply it got (plan-ui-redesign.md 7.4). */
export function CompanyHistorySection({ companyId }: { companyId: string }) {
  const q = useApiQuery<CompanyHistory>(['companies', companyId, 'history'], `/api/companies/${companyId}/history`)
  if (q.isPending) return <SectionSkeleton rows={3} />
  if (q.isError)
    return (
      <Section title="History">
        <p className="text-sm text-danger-text">Could not load the history: {q.error.message}</p>
      </Section>
    )
  const h = q.data.data
  return (
    <Section title="History" count={h.items.length} description="Every application to this company and the answer it got." contentClassName="p-0">
      <div className="border-b px-4 py-3">
        <RuleLine rule={h.rule} lastSentAt={h.lastSentAt} />
      </div>
      {h.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No applications to this company yet.</p>
      ) : (
        <ListRows>
          {h.items.map((a) => (
            <ListRow key={a.applicationId} href={`/applications/${a.applicationId}`} className="flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {a.countryCode ? `${flagEmoji(a.countryCode)} ${a.countryCode} · ` : ''}
                  {a.sentAt ? (
                    <span title={fmtDate(a.sentAt)}>
                      Sent {fmtDate(a.sentAt)}
                      {a.submittedVia && VIA_LABEL[a.submittedVia] ? ` ${VIA_LABEL[a.submittedVia]}` : ''}
                    </span>
                  ) : (
                    `Not sent · last activity ${fmtAgo(a.lastActivityAt)}`
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <ChannelBadge channel={a.channel} />
                <AppStatusBadge status={a.status} />
                {a.reply ? <ReplyBadge classification={a.reply.classification} /> : null}
              </div>
            </ListRow>
          ))}
        </ListRows>
      )}
    </Section>
  )
}
