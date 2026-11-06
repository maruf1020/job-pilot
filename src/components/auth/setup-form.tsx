'use client'

import { useActionState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { setupAction, type SetupFormState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthCard } from './auth-card'

/** First run: the one account of this install. setupAction redirects to /login?created=1. */
export function SetupForm({ removed = false }: { removed?: boolean }) {
  const [state, action, pending] = useActionState<SetupFormState, FormData>(setupAction, null)
  return (
    <AuthCard
      title="Create your account"
      subtitle="This install keeps everything on this machine and its own database. Nothing is sent anywhere until you add keys and start a search."
      footer="One account per install. You can change the name and password later in Settings > Account."
    >
      {removed ? (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success-text">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your data was removed. Create a new account to start again.
        </p>
      ) : null}
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-name">Name</Label>
          {/* Remounted per answer: Base UI warns when an uncontrolled field's default value changes. */}
          <Input key={state?.name ?? ''} id="setup-name" name="name" required minLength={2} maxLength={80} autoComplete="username" autoFocus defaultValue={state?.name ?? ''} className="h-10" placeholder="Alex Rivera" aria-describedby="setup-name-help" />
          <p id="setup-name-help" className="text-xs text-muted-foreground">
            You log in with this name. Capital letters do not matter.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-password">Password</Label>
          <Input id="setup-password" name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className="h-10" aria-describedby="setup-password-help" />
          <p id="setup-password-help" className="text-xs text-muted-foreground">
            At least 10 characters.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-confirm">Confirm password</Label>
          <Input id="setup-confirm" name="confirm" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className="h-10" />
        </div>
        {state?.error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? 'Creating the account' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  )
}
