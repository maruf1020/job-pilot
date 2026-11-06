import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Job Pilot', template: '%s · Job Pilot' },
  description: 'Finds jobs that fit you, ranks them, drafts human applications and tracks replies.',
  // Icons come from src/app/icon.svg, icon.png and apple-icon.png (Next picks them up automatically).
  applicationName: 'Job Pilot',
  appleWebApp: { capable: true, title: 'Job Pilot', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9f8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#171513' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
