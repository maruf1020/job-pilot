import type { ReactNode } from 'react'
import { LogoMark } from '@/components/brand/logo'

/** The shared frame of the login and setup pages: logo tile, one heading, a card, a footnote. */
export function AuthCard({ title, subtitle, footer, children }: { title: string; subtitle?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full max-w-[24rem]">
      <div className="mb-6 flex flex-col items-center text-center">
        <LogoMark size={44} className="mb-4" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">{children}</div>
      {footer ? <p className="mt-6 text-center text-xs text-muted-foreground">{footer}</p> : null}
    </div>
  )
}
