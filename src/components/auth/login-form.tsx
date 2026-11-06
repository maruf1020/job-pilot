'use client'

import { useActionState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { googleLoginAction, loginAction, type AuthFormState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthCard } from './auth-card'

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12S6.6 21.8 12 21.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  )
}

/** Centred login card: name (or account email) and password; Google when it is configured. */
export function LoginForm({ googleEnabled = false, oauthError = null, next = '', note = null }: { googleEnabled?: boolean; oauthError?: string | null; next?: string; note?: string | null }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(loginAction, null)
  return (
    <AuthCard title="Log in to Job Pilot" subtitle="Your applications, replies and runs in one place." footer="Private workspace. Only this install's account can log in.">
      {note ? (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success-text">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          {note}
        </p>
      ) : null}
      {googleEnabled ? (
        <>
          <form action={googleLoginAction}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="outline" className="h-10 w-full">
              <GoogleMark className="size-4" /> Continue with Google
            </Button>
          </form>
          {oauthError ? (
            <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
              {oauthError}
            </p>
          ) : null}
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or with your password
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username">Name</Label>
          <Input
            key={state?.username ?? ''}
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus={!googleEnabled}
            defaultValue={state?.username ?? ''}
            className="h-10"
            aria-describedby="username-help"
          />
          <p id="username-help" className="text-xs text-muted-foreground">
            The name you chose at setup, or your account email.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
        </div>
        {state?.error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-text">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? 'Logging in' : 'Log in'}
        </Button>
      </form>
    </AuthCard>
  )
}
