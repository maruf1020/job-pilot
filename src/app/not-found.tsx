import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { LogoMark } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-[var(--shadow-card)]">
        <LogoMark size={40} className="mx-auto mb-4" />
        <p className="text-xs font-medium text-muted-foreground tabular-nums">Error 404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">The link may be old, or the page has moved.</p>
        <Button className="mt-5" nativeButton={false} render={<Link href="/dashboard" />}>
          <ArrowLeft className="size-4" /> Go to Today
        </Button>
      </div>
    </main>
  )
}
