/**
 * web-ui/app/layout.tsx — Root layout + app shell (UI-001, UI-007, UI-10).
 *
 * Design-system foundation: IBM Plex (build-time next/font, no runtime
 * request), the pre-paint theme script (no flash) and the theme manager that
 * follows OS changes for mode=system.
 */

import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ThemeManager } from '@/components/ThemeManager';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const sans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
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
