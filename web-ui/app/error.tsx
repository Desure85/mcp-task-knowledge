'use client';

/**
 * Route-level error boundary (F-01, UI-13).
 *
 * Without this file Next showed its bare "This page couldn't load" screen for
 * any render error (the Knowledge document crash was the first one users hit).
 * Keep the recovery path obvious: retry the route, or go back to Overview.
 */

import Link from 'next/link';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
      <p className="mt-3 text-gray-600">
        This page failed to load. Your data is safe — retry, or continue from the Overview.
      </p>
      {error.digest && <p className="mt-2 text-xs text-gray-400">Error reference: {error.digest}</p>}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Try again
        </button>
        <Link href="/" className="px-4 py-2 border rounded-lg hover:bg-gray-50 transition">
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
