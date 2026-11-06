'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyButton({ text, label = 'Copy', size = 'sm', className }: { text: string; label?: string; size?: 'xs' | 'sm' | 'default'; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : label}
    </Button>
  )
}
