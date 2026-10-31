'use client';

/**
 * Route-level error boundary (F-01, UI-13).
 *
 * Without this file Next showed its bare "This page couldn't load" screen for
 * any render error (the Knowledge document crash was the first one users hit).
 * Keep the recovery path obvious: retry the route, or go back to Overview.
 */

import Link from 'next/link';
import { Button } from '@/components/ui';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-[24px] font-semibold text-ink">Something went wrong</h1>
      <p className="mt-3 text-[13px] text-muted">
        This page failed to load. Your data is safe — retry, or continue from the Overview.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-muted">Error reference: {error.digest}</p>}
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button variant="primary" onClick={reset}>Try again</Button>
        <Link
          href="/"
          className="inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[12px] font-medium text-ink transition hover:bg-surface-2"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
