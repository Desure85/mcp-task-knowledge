/**
 * web-ui/app/layout.tsx — Root layout (UI-001)
 */

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MCP Task & Knowledge',
  description: 'Task management and knowledge base — MCP-powered',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="border-b bg-white px-6 py-3 flex items-center gap-6">
          <a href="/" className="font-bold text-lg">MCP Tasks</a>
          <a href="/tasks" className="hover:text-blue-600">Tasks</a>
          <a href="/knowledge" className="hover:text-blue-600">Knowledge</a>
          <a href="/prompts" className="hover:text-blue-600">Prompts</a>
          <a href="/search" className="hover:text-blue-600">Search</a>
        </nav>
        <main className="max-w-6xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
