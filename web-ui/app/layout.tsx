/**
 * web-ui/app/layout.tsx — Root layout + app shell (UI-001, UI-007)
 *
 * Fixed 248px sidebar on lg+, sticky 56px top bar, neutral canvas with a
 * 1400px content column. Below lg the sidebar becomes a scrollable nav strip.
 */

import type { Metadata } from 'next';
import './globals.css';
import { MobileNav, Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

export const metadata: Metadata = {
  title: 'MCP Task & Knowledge',
  description: 'Task management and knowledge base — MCP-powered',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-neutral-900">
        <Sidebar />
        <div className="lg:pl-[248px]">
          <Topbar />
          <MobileNav />
          <main className="px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
