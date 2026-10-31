'use client';

/**
 * Root-layout error boundary (UI-13). A failure here replaces the whole
 * document, so keep it dependency-light. Inline CSS variables fall back to
 * system colours if the design-token stylesheet did not load.
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
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          background: 'var(--canvas, Canvas)',
          color: 'var(--ink, CanvasText)',
        }}
      >
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 12, color: 'var(--muted, GrayText)' }}>
            The application failed to load. Your data is safe — retry, or reload the Overview.
          </p>
          {error.digest && (
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted, GrayText)' }}>
              Error reference: {error.digest}
            </p>
          )}
          <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px',
                border: 0,
                borderRadius: 3,
                background: 'var(--accent, AccentColor)',
                color: 'var(--on-accent, AccentColorText)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: '8px 16px',
                border: '1px solid var(--line, ButtonBorder)',
                borderRadius: 3,
                background: 'var(--surface, Canvas)',
                color: 'var(--ink, CanvasText)',
                textDecoration: 'none',
              }}
            >
              Back to Overview
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
