/**
 * UI-24 guard: migrated pages/shell files must use semantic tokens only.
 *
 * Add a file here when its page(s) are migrated. The allowlist exists for
 * intentional exceptions (e.g. an inline SVG brand logo with a fixed colour);
 * keep entries narrow and add a comment why.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATED_FILES = [
  'app/tasks/page.tsx',
  'app/knowledge/page.tsx',
  'app/page.tsx',
  'app/access/page.tsx',
  'app/login/page.tsx',
  'components/AppShell.tsx',
  'components/Sidebar.tsx',
  'components/Topbar.tsx',
  'components/PageHeader.tsx',
  'components/EmptyState.tsx',
  'components/Skeleton.tsx',
  'components/Badge.tsx',
  'components/PriorityDot.tsx',
  'components/StatTile.tsx',
  'components/HomeStats.tsx',
  'components/BrandMark.tsx',
  'components/ThemeSwitcher.tsx',
  'components/ThemeManager.tsx',
  'lib/realtime.ts',
  'lib/knowledge.ts',
  'lib/markdown.ts',
];

/** File → substrings that are intentional (keep this empty unless justified). */
const ALLOWLIST: Record<string, string[]> = {
  // Example: 'components/BrandMark.tsx': ['#4f46e5'], // inline brand mark
};

const TAILWIND_COLOR =
  /(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?/g;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

describe('UI-24: no hardcoded colours in migrated files', () => {
  it('lists real migrated files (guards against a silently empty scan)', () => {
    for (const file of MIGRATED_FILES) {
      expect(() => readFileSync(path.join(process.cwd(), file), 'utf8')).not.toThrow();
    }
  });

  it('uses semantic tokens only (no Tailwind palette colours or hex)', () => {
    const violations: string[] = [];

    for (const file of MIGRATED_FILES) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8');
      const allowed = ALLOWLIST[file] ?? [];
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        const cleaned = allowed.reduce((acc, token) => acc.split(token).join(''), line);
        const hits = [...(cleaned.match(TAILWIND_COLOR) ?? []), ...(cleaned.match(HEX_COLOR) ?? [])];
        if (hits.length > 0) violations.push(`${file}:${index + 1} → ${hits.join(', ')}`);
      });
    }

    const message = violations.length
      ? `Hardcoded colours found in migrated files (use tokens from globals.css):\n${violations.join('\n')}`
      : undefined;
    if (violations.length) console.error(message);
    expect(violations, message).toEqual([]);
  });
});
