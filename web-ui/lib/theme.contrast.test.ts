/**
 * WCAG AA gate for every palette × mode (UI-10).
 *
 * `app/globals.css` is the single source of truth: this test parses the six
 * `[data-theme][data-mode]` blocks, so CSS and the gate cannot drift apart.
 * Adds/changes to a palette automatically require the pair to pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio } from './contrast';

type Tokens = Record<string, string>;

const THEMES = ['indigo', 'petrol', 'copper'] as const;
const MODES = ['light', 'dark'] as const;

const TEXT_PAIRS: Array<[string, string, number]> = [
  ['ink', 'canvas', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'canvas', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['ink', 'surface-2', 4.5],
  ['accent', 'canvas', 4.5],
  ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ...['st-todo', 'st-doing', 'st-review', 'st-blocked', 'st-done', 'st-archive'].map(
    (key) => [key, 'surface', 4.5] as [string, string, number],
  ),
  ...['st-todo', 'st-doing', 'st-review', 'st-blocked', 'st-done', 'st-archive'].map(
    (key) => [key, 'surface-2', 3] as [string, string, number],
  ),
  ...['ty-bug', 'ty-feature', 'ty-task'].map(
    (key) => [key, 'surface', 4.5] as [string, string, number],
  ),
  ...['pr-high', 'pr-med', 'pr-low'].map(
    (key) => [key, 'surface', 4.5] as [string, string, number],
  ),
  ...['pr-high', 'pr-med', 'pr-low'].map(
    (key) => [key, 'surface-2', 3] as [string, string, number],
  ),
  ['line-strong', 'canvas', 3],
  ['st-done', 'canvas', 3],
  ['focus-ring', 'canvas', 3],
  // UI-28 graph: superseded (archive) nodes and non-text accents on the canvas,
  // plus the accent on the raised row used by selected list items.
  ['st-archive', 'canvas', 3],
  ['danger', 'canvas', 3],
  ['success', 'canvas', 3],
];

function css(): string {
  return readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8');
}

function blocks(source: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

function parseTokens(body: string): Tokens {
  const tokens: Tokens = {};
  const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) tokens[match[1]] = match[2];
  // The CSS exposes `--focus`; the test pair name is `focus-ring`.
  if (tokens.focus) tokens['focus-ring'] = tokens.focus;
  return tokens;
}

function variantTokens(source: string, theme: string, mode: string): Tokens {
  const all = blocks(source).filter(
    (b) => b.selector.includes(`[data-theme="${theme}"]`) && b.selector.includes(`[data-mode="${mode}"]`),
  );
  if (all.length !== 1) throw new Error(`expected one block for ${theme}/${mode}, found ${all.length}`);
  return parseTokens(all[0].body);
}

describe('UI-10: WCAG AA across palettes and modes', () => {
  const source = css();
  const rows: string[] = [];
  const failures: string[] = [];

  for (const theme of THEMES) {
    for (const mode of MODES) {
      const tokens = variantTokens(source, theme, mode);
      let min = Infinity;
      for (const [fg, bg, threshold] of TEXT_PAIRS) {
        const fgValue = tokens[fg];
        const bgValue = tokens[bg];
        if (!fgValue || !bgValue) {
          failures.push(`${theme}/${mode}: missing token ${fgValue ? bg : fg}`);
          continue;
        }
        const ratio = contrastRatio(fgValue, bgValue);
        min = Math.min(min, ratio);
        if (ratio + 1e-9 < threshold) {
          failures.push(`${theme}/${mode}: ${fg} on ${bg} = ${ratio.toFixed(2)} (need ${threshold})`);
        }
      }
      rows.push(`${theme}/${mode}: ${TEXT_PAIRS.length} pairs, min ${min.toFixed(2)}:1`);
    }
  }

  it('has all six palette × mode variants', () => {
    expect(rows).toHaveLength(6);
  });

  it('every required pair meets its threshold', () => {
    const message = failures.length
      ? `Contrast failures:\n${failures.join('\n')}\n\nSummary:\n${rows.join('\n')}`
      : undefined;
    if (failures.length) console.error(message);
    expect(failures, message).toEqual([]);
    console.log(`Contrast OK (${TEXT_PAIRS.length} pairs × 6 variants):\n${rows.join('\n')}`);
  });
});

