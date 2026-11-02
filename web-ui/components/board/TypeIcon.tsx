/**
 * web-ui/components/board/TypeIcon.tsx — task-type glyph (V-05).
 *
 * Three glyphs only: bug, feature (sparkle) and task/unknown (check-square).
 * Stroke-only paths in `currentColor` so the caller owns the tone through a
 * `text-ty-*` token; no colour is hardcoded here. Hook-free on purpose: the
 * board components must render on the server for the component test.
 */

type TypeIconProps = {
  /** Type id (`bug`, `feature`, `task`, …) — the project may rename ids. */
  type?: string;
  /** Optional `icon` hint from the project type config; wins over `type`. */
  icon?: string;
  className?: string;
  title?: string;
};

function Glyph({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-3.5 w-3.5 shrink-0'}
    >
      {children}
    </svg>
  );
}

/** A beetle seen from above: oval body, three leg pairs, antennae. */
function BugGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <ellipse cx="12" cy="13" rx="4.5" ry="6" />
      <path d="M12 7v12" />
      <path d="M7.5 9.5 4 7M7.5 13H3.5M7.5 16.5 4 19M16.5 9.5 20 7M16.5 13h4M16.5 16.5 20 19" />
    </Glyph>
  );
}

/** Sparkle plus a small second sparkle — "new capability". */
function FeatureGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M11 4.5 12.6 9l4.4 1.6-4.4 1.6L11 16.6 9.4 12.2 5 10.6 9.4 9z" />
      <path d="M17.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </Glyph>
  );
}

/** Check-square — the neutral "work item" glyph. */
function TaskGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Glyph>
  );
}

function resolveGlyph(type?: string, icon?: string): 'bug' | 'feature' | 'task' {
  const key = `${icon ?? ''}`.trim().toLowerCase() || `${type ?? ''}`.trim().toLowerCase();
  if (key === 'bug') return 'bug';
  if (key === 'feature') return 'feature';
  return 'task';
}

export function TypeIcon({ type, icon, className, title }: TypeIconProps) {
  const glyph = resolveGlyph(type, icon);
  const svg =
    glyph === 'bug' ? (
      <BugGlyph className={className} />
    ) : glyph === 'feature' ? (
      <FeatureGlyph className={className} />
    ) : (
      <TaskGlyph className={className} />
    );

  if (!title) return svg;

  return (
    <span className="inline-flex" role="img" aria-label={title} title={title}>
      {svg}
    </span>
  );
}
