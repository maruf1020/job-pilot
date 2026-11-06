'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Section } from '@/components/shared/section'
import { Button } from '@/components/ui/button'
import { toPlainText } from '@/lib/text'
import { cn } from '@/lib/utils'

const COLLAPSE_AFTER = 1600

/** The posting text, at reading width (70ch), folded when long. */
export function JobDescriptionCard({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false)
  // Older rows can still hold HTML a feed escaped twice; show readable text either way.
  const text = useMemo(() => toPlainText(description), [description])
  const long = text.length > COLLAPSE_AFTER
  const collapsed = long && !expanded

  return (
    <Section title="Description">
      {text ? (
        <>
          <div className={cn('relative', collapsed && 'max-h-[28rem] overflow-hidden')}>
            <p className="max-w-[70ch] text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-foreground">{text}</p>
            {collapsed ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card to-transparent" /> : null}
          </div>
          {long ? (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {expanded ? 'Show less' : 'Show the full description'}
            </Button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No description was captured for this posting.</p>
      )}
    </Section>
  )
}
