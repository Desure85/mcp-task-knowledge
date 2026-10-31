/**
 * UI-24 guard: every app page/component and top-level shell component must
 * use semantic tokens only. Files are discovered dynamically so a new page
 * cannot silently escape the scan.
 *
 * The allowlist exists for intentional exceptions (the static brand favicon);
 * keep entries narrow and add a comment why.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function walkTsx(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkTsx(rel));
    else if (entry.name.endsWith('.tsx')) files.push(rel);
  }
  return files;
}

const APP_FILES = walkTsx('app');
const COMPONENT_FILES = readdirSync('components', { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
  .map((entry) => `components/${entry.name}`);
const LIB_FILES = [
  'lib/realtime.ts',
  'lib/knowledge.ts',
  'lib/markdown.ts',
  'lib/graph-theme.ts',
];
const BRAND_ASSETS = ['app/icon.svg'];

const MIGRATED_FILES = [...new Set([...APP_FILES, ...COMPONENT_FILES, ...LIB_FILES, ...BRAND_ASSETS])].sort();

const REQUIRED_UI24_PAGES = [
  'app/page.tsx',
  'app/tasks/page.tsx',
  'app/knowledge/page.tsx',
  'app/memory/page.tsx',
  'app/analytics/page.tsx',
  'app/graph/page.tsx',
  'app/prompts/page.tsx',
  'app/projects/page.tsx',
  'app/system/page.tsx',
  'app/search/page.tsx',
  'app/access/page.tsx',
  'app/login/page.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
];

/** File → substrings that are intentional (keep this empty unless justified). */
const ALLOWLIST: Record<string, string[]> = {
  // Fixed brand favicon; loaded as a static image, so CSS tokens do not apply.
  'app/icon.svg': ['#4f46e5', '#fff'],
};

const TAILWIND_COLOR =
  /(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?/g;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/g;

describe('UI-24: no hardcoded colours in migrated files', () => {
  it('covers the final UI-24 pages and error boundaries', () => {
    for (const file of REQUIRED_UI24_PAGES) expect(MIGRATED_FILES).toContain(file);
  });

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
