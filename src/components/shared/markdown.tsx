'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import 'highlight.js/styles/github-dark.css'
import { cn } from '@/lib/utils'

/**
 * Styles for rendered markdown (no typography plugin in this app). Code blocks are always dark with
 * GitHub-dark syntax colours, so they read the same in the light and dark theme.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mt-6 mb-3 text-xl font-bold tracking-tight text-primary first:mt-0">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="mt-7 mb-3 rounded-r-md border-l-4 border-sky-500 bg-sky-500/10 py-1.5 pl-3 text-base font-semibold text-sky-800 first:mt-0 dark:text-sky-200">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-5 mb-2 text-sm font-semibold text-violet-700 first:mt-0 dark:text-violet-300">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 mb-1 font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 marker:text-sky-500">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:font-semibold marker:text-sky-500">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  // Labels like "Your answer:" and "Review:" stand out so a long review is easy to scan.
  strong: ({ children }) => <strong className="font-semibold text-amber-700 dark:text-amber-300">{children}</strong>,
  em: ({ children }) => <em className="text-foreground/90 italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-lg border-l-4 border-amber-500 bg-amber-500/10 px-3 py-1 text-amber-900 dark:text-amber-100 [&_strong]:text-amber-800 dark:[&_strong]:text-amber-200">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-dashed border-border" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline underline-offset-2 dark:text-sky-400">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-[#0d1117] p-3 font-mono text-xs leading-relaxed text-[#e6edf3] shadow-sm [&_code.hljs]:bg-transparent [&_code.hljs]:p-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    // Fenced blocks carry a language/hljs class and sit inside <pre>; the rest are inline.
    className ? (
      <code className={cn('font-mono', className)}>{children}</code>
    ) : (
      <code className="rounded bg-rose-500/10 px-1 py-0.5 font-mono text-[0.85em] text-rose-700 dark:text-rose-300">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/50 px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('text-sm wrap-break-word', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
