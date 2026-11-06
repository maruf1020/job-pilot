'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Bot, CheckCircle2, ExternalLink, FileText, Mail, MoreHorizontal, RefreshCw, SkipForward, Undo2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiEnvelope } from '@/lib/api/client'
import { api, useApiMutation } from '@/lib/api/hooks'
import { useCooldownConfirm } from '@/components/shared/cooldown-warning'
import { cn } from '@/lib/utils'
import type { JobAction, JobDetail } from './types'

interface ActionResult {
  queued?: boolean
  status?: string
  blacklisted?: boolean
  id?: string
}

export interface JobActionVars {
  action: JobAction
  note?: string
  ignoreCooldown?: boolean
}

function describeResult(data: ActionResult, env: ApiEnvelope<ActionResult>): string {
  if (env.message && env.message !== 'OK') return env.message
  if (data.blacklisted) return 'Company blacklisted; its open jobs were skipped'
  if (data.status === 'SKIPPED') return 'Job skipped'
  if (data.status === 'RANKED') return 'Job restored'
  return 'Done'
}

/** One mutation shared by the header actions and the application side panel. */
export function useJobActionMutation(jobId: string) {
  return useApiMutation<JobActionVars, ActionResult>((vars) => api.post(`/api/jobs/${jobId}/actions`, vars), {
    invalidate: [['jobs'], ['applications'], ['companies']],
    successMessage: describeResult,
  })
}

export type JobActionMutation = ReturnType<typeof useJobActionMutation>

const APPLIED_STATUSES = new Set(['SENT', 'REPLIED', 'INTERVIEW', 'OFFER'])

export function isAlreadyApplied(job: JobDetail): boolean {
  return job.status === 'APPLIED' || (job.application ? APPLIED_STATUSES.has(job.application.status) : false)
}

/** A row of the phone actions sheet. */
function SheetAction({ icon, children, onClick, disabled, destructive }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn('flex h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', destructive ? 'text-danger-text' : 'text-foreground')}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Job actions (plan-ui-redesign.md, Group C): the primary action fits the job's channel (a form for
 * ATS and portal jobs, an email draft for email jobs), Skip and Mark applied stay visible, the rest
 * sit in More. On phones a bar above the tab bar keeps the two main actions in reach.
 */
export function JobActions({ job, mutation }: { job: JobDetail; mutation: JobActionMutation }) {
  const [appliedOpen, setAppliedOpen] = useState(false)
  const [note, setNote] = useState('')
  const [blacklistOpen, setBlacklistOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const router = useRouter()
  const busy = mutation.isPending
  const cooldownGuard = useCooldownConfirm(job.cooldown ?? null)
  const alreadyApplied = isAlreadyApplied(job)
  const skipped = job.status === 'SKIPPED'
  // Browser agent: fill the job's application form (stops before Submit), then review on the application page.
  const portal = useApiMutation<{ action: 'fill' }, { applicationId: string; attemptId: string }>((v) => api.post(`/api/jobs/${job.id}/portal`, v), {
    invalidate: [['jobs'], ['applications']],
    onSuccess: (d) => router.push(`/applications/${d.applicationId}`),
  })
  const emailFirst = job.applyChannel === 'email'

  const draft = { label: 'Draft application', icon: <FileText />, run: () => mutation.mutate({ action: 'draft' }), disabled: busy || alreadyApplied, title: 'Write a tailored email or cover letter you review before anything is sent' }
  const browser = {
    label: 'Apply in browser',
    icon: <Bot />,
    run: () => portal.mutate({ action: 'fill' }),
    disabled: busy || alreadyApplied || portal.isPending,
    title: 'The agent opens the application form and fills it; you review and submit',
  }
  const primary = emailFirst ? draft : browser
  const secondary = emailFirst ? browser : draft
  const openPosting = () => window.open(job.url, '_blank', 'noopener,noreferrer')
  const closeSheetThen = (fn: () => void) => () => {
    setSheetOpen(false)
    fn()
  }

  return (
    <>
      {cooldownGuard.dialog}

      {/* md and up: one row in the header */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        <Button size="sm" disabled={primary.disabled} onClick={primary.run} title={primary.title}>
          {primary.icon} {primary.label}
        </Button>
        <Button size="sm" variant="outline" disabled={secondary.disabled} onClick={secondary.run} title={secondary.title}>
          {secondary.icon} {secondary.label}
        </Button>
        {skipped ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => mutation.mutate({ action: 'unskip' })}>
            <Undo2 /> Unskip
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy || alreadyApplied} onClick={() => mutation.mutate({ action: 'skip' })}>
            <SkipForward /> Skip
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy || alreadyApplied} onClick={() => setAppliedOpen(true)}>
          <CheckCircle2 /> Mark applied
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" disabled={busy} aria-label="More actions">
                <MoreHorizontal /> More
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={openPosting}>
              <ExternalLink className="size-4" /> Open posting
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => mutation.mutate({ action: 'find-contact' })}>
              <Mail className="size-4" /> Find a contact email
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => mutation.mutate({ action: 'rescore' })}>
              <RefreshCw className="size-4" /> Enrich and score again
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={job.company.blacklisted} onClick={() => setBlacklistOpen(true)}>
              <Ban className="size-4" /> {job.company.blacklisted ? 'Company blacklisted' : 'Blacklist company'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Phones: a bar above the tab bar with the two main actions and a sheet for the rest */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden">
        <div className="flex items-center gap-2">
          <Button className="h-10 flex-1" disabled={primary.disabled} onClick={primary.run}>
            {primary.icon} {primary.label}
          </Button>
          <Button variant="outline" className="h-10 flex-1" disabled={secondary.disabled} onClick={secondary.run}>
            {secondary.icon} {emailFirst ? 'Browser' : 'Draft'}
          </Button>
          <Button variant="outline" size="icon-lg" className="size-10" aria-label="More actions" onClick={() => setSheetOpen(true)}>
            <MoreHorizontal />
          </Button>
        </div>
      </div>
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Actions</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col px-2 pb-2">
            {skipped ? (
              <SheetAction icon={<Undo2 />} disabled={busy} onClick={closeSheetThen(() => mutation.mutate({ action: 'unskip' }))}>
                Unskip
              </SheetAction>
            ) : (
              <SheetAction icon={<SkipForward />} disabled={busy || alreadyApplied} onClick={closeSheetThen(() => mutation.mutate({ action: 'skip' }))}>
                Skip this job
              </SheetAction>
            )}
            <SheetAction icon={<CheckCircle2 />} disabled={busy || alreadyApplied} onClick={closeSheetThen(() => setAppliedOpen(true))}>
              Mark applied
            </SheetAction>
            <SheetAction icon={<ExternalLink />} onClick={closeSheetThen(openPosting)}>
              Open posting
            </SheetAction>
            <SheetAction icon={<Mail />} disabled={busy} onClick={closeSheetThen(() => mutation.mutate({ action: 'find-contact' }))}>
              Find a contact email
            </SheetAction>
            <SheetAction icon={<RefreshCw />} disabled={busy} onClick={closeSheetThen(() => mutation.mutate({ action: 'rescore' }))}>
              Enrich and score again
            </SheetAction>
            <SheetAction icon={<Ban />} destructive disabled={busy || job.company.blacklisted} onClick={closeSheetThen(() => setBlacklistOpen(true))}>
              {job.company.blacklisted ? 'Company blacklisted' : 'Blacklist company'}
            </SheetAction>
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={appliedOpen} onOpenChange={setAppliedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as applied</DialogTitle>
            <DialogDescription>Use this when you applied outside the app (portal, ATS form, referral). The job moves to Applied and an application record is created.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="applied-note">Note (optional)</Label>
            <Textarea id="applied-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where and how you applied, reference number…" maxLength={2000} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAppliedOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                cooldownGuard.guard((ignoreCooldown) =>
                  mutation.mutate(
                    { action: 'mark-applied', note: note.trim() || undefined, ignoreCooldown },
                    {
                      onSuccess: () => {
                        setAppliedOpen(false)
                        setNote('')
                      },
                    },
                  ),
                )
              }
            >
              {busy ? 'Saving…' : 'Mark applied'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={blacklistOpen} onOpenChange={setBlacklistOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blacklist {job.company.name}?</AlertDialogTitle>
            <AlertDialogDescription>Every open job from this company will be skipped and future postings from it will be ignored. You can undo this from the company page.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => mutation.mutateAsync({ action: 'blacklist-company' }).then(() => setBlacklistOpen(false)).catch(() => null)}>
              Blacklist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
