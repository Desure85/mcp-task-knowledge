/**
 * web-ui/app/layout.tsx — Root layout + app shell (UI-001, UI-007)
 *
 * Shell lives in AppShell (route guard + bare /login). Fixed 248px sidebar on lg+, sticky 56px top bar, neutral canvas with a
 * 1400px content column. Below lg the sidebar becomes a scrollable nav strip.
 */

import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'MCP Task & Knowledge',
  description: 'Task management and knowledge base — MCP-powered',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-neutral-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
