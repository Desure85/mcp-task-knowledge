/**
 * web-ui/app/layout.tsx — Root layout + app shell (UI-001, UI-007, UI-10).
 *
 * Design-system foundation: IBM Plex self-hosted through `next/font/local`
 * (files in `app/fonts`, so `next build` never needs the network — DX-34),
 * the pre-paint theme script (no flash) and the theme manager that follows OS
 * changes for mode=system.
 */

import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ThemeManager } from '@/components/ThemeManager';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

/**
 * One file per weight with both the latin and the cyrillic subset inside:
 * `localFont` never emits `unicode-range`, so splitting a weight into two
 * subset files (latin + cyrillic) would leave only the last one effective and
 * silently drop Cyrillic to a system face. See `app/fonts/README.md`.
 */
const sans = localFont({
  src: [
    { path: './fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-sans',
  display: 'swap',
  fallback: ['IBM Plex Sans'],
});

const mono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
  fallback: ['IBM Plex Mono'],
});

export const metadata: Metadata = {
  title: 'MCP Task & Knowledge',
  description: 'Task management and knowledge base — MCP-powered',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        {/* Applies data-theme/data-mode before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink">
        <ThemeManager />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
