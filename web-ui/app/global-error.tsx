'use client';

/**
 * Root-layout error boundary (UI-13). A failure here replaces the whole
 * document, so keep it dependency-light and use inline styles (global CSS may
 * not have loaded).
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 12, color: '#475569' }}>
            The application failed to load. Your data is safe — retry, or reload the Overview.
          </p>
          {error.digest && <p style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Error reference: {error.digest}</p>}
          <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{ padding: '8px 16px', border: 0, borderRadius: 8, background: '#2563eb', color: '#fff', cursor: 'pointer' }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', textDecoration: 'none' }}
            >
              Back to Overview
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
