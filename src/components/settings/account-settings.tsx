'use client'

import { useActionState, useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Loader2, Trash2 } from 'lucide-react'
import { accountEmailAction, changePasswordAction, renameAction, type AccountFormState } from '@/lib/auth/actions'
import { api, ApiError } from '@/lib/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field, SectionCard } from './fields'

function FormNote({ state }: { state: AccountFormState }) {
  if (state?.error)
    return (
      <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
        {state.error}
      </p>
    )
  if (state?.ok)
    return (
      <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success-text">
        {state.ok}
      </p>
    )
  return null
}

/** After a successful save the server-rendered name in the menu is stale: re-render it. */
function useRefreshOnOk(state: AccountFormState) {
  const router = useRouter()
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])
}

function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(renameAction, null)
  useRefreshOnOk(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Name" htmlFor="acc-name" help="You log in with this name (any capitals work).">
        <Input id="acc-name" name="name" defaultValue={name} required minLength={2} maxLength={80} autoComplete="username" />
      </Field>
      <FormNote state={state} />
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save name
      </Button>
    </form>
  )
}

function EmailForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(accountEmailAction, null)
  useRefreshOnOk(state)
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Account email (optional)" htmlFor="acc-email" help='Also works as a login name, and lets you use "Continue with Google" when that is set up. Leave empty to remove it.'>
        <Input id="acc-email" name="email" type="email" defaultValue={email ?? ''} maxLength={200} autoComplete="email" placeholder="alex@example.com" />
      </Field>
      <FormNote state={state} />
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save email
      </Button>
    </form>
  )
}

function PasswordForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(changePasswordAction, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Current password" htmlFor="acc-current">
        <Input id="acc-current" name="current" type="password" required autoComplete="current-password" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password" htmlFor="acc-new" help="At least 10 characters.">
          <Input id="acc-new" name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
        </Field>
        <Field label="New password again" htmlFor="acc-confirm">
          <Input id="acc-confirm" name="confirm" type="password" required minLength={10} maxLength={200} autoComplete="new-password" />
        </Field>
      </div>
      <FormNote state={state} />
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Change password
      </Button>
    </form>
  )
}

const DELETED = [
  'Your account, profile, CVs and photo',
  'Applications with their emails, drafts, form attempts and history',
  'Apply and email batches, job scores, inbox and notifications',
  'Saved form answers and site logins, the Gmail connection',
  'AI keys, service keys and their usage',
  'Search runs and your settings (back to the defaults)',
  'Personal files in the storage folder: CV copies, cover letters, screenshots, browser profiles, logs',
]

const KEPT = [
  'Companies (blacklist and notes cleared)',
  'Jobs (back to new, scores removed) and where they were found',
  'Job boards, scrape targets and sponsor registers',
  'Banned phrases, site profiles (logged out) and site lessons',
  'Bounced addresses and board-discovery history',
]

function RemoveDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/account/remove', { name, password })
      // The account is gone too, so the next stop is a fresh setup (a full load drops all client state).
      window.location.assign(new URL('/setup?removed=1', window.location.origin).toString())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the data')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        setOpen(o)
        if (!o) {
          setName('')
          setPassword('')
          setError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2 className="size-3.5" /> Remove my data
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Remove my data?</DialogTitle>
            <DialogDescription>This cannot be undone. Download your data first if you want a copy. Afterwards the app starts again at account setup.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md bg-danger-soft p-3">
              <p className="font-medium text-danger-text">Deleted</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-foreground/90">
                {DELETED.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md bg-muted p-3">
              <p className="font-medium">Kept (shared knowledge)</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {KEPT.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <Field label="Type your account name to confirm" htmlFor="rm-name">
            <Input id="rm-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
          </Field>
          <Field label="Your password" htmlFor="rm-password">
            <Input id="rm-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <DialogFooter showCloseButton>
            <Button type="submit" variant="destructive" disabled={busy || !name.trim() || !password}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              {busy ? 'Removing' : 'Remove everything listed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Settings > Account: name, email, password and the danger zone. */
export function AccountSettings({ name, email }: { name: string; email: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Your account" description="This install has one account. Everything it stores stays on this machine and its database.">
        <NameForm name={name} />
        <div className="border-t pt-4">
          <EmailForm email={email} />
        </div>
      </SectionCard>
      <SectionCard title="Password" description="Changing it signs you out everywhere; you then log in again with the new password.">
        <PasswordForm />
      </SectionCard>
      <SectionCard title="Danger zone" className="border-destructive/40" description="Hand this install to someone else, or start over.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Download my data</p>
            <p className="text-xs text-muted-foreground">Your profile, saved answers, applications and settings as one JSON file.</p>
          </div>
          <Button size="sm" variant="outline" className="self-start sm:self-auto" nativeButton={false} render={<a href="/api/account/export" download />}>
            <Download className="size-3.5" /> Download
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Remove my data</p>
            <p className="text-xs text-muted-foreground">Deletes everything about you and keeps the shared job knowledge. You need your name and password.</p>
          </div>
          <div className="self-start sm:self-auto">
            <RemoveDialog />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
