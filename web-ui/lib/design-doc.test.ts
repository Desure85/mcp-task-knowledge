/**
 * UI-34 guard: DESIGN.md cannot drift from the code.
 *
 * The token table and the primitive catalog are generated from
 * `app/globals.css`, `lib/theme.ts` and `components/ui` by
 * `scripts/gen-design-doc.mjs`. This test regenerates both blocks in memory
 * and compares them with the committed document, so a palette, a token or a
 * primitive added without `npm run design:doc` fails CI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDesignDoc, renderPrimitivesBlock, renderTokenBlock } from '../../scripts/gen-design-doc.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESIGN = path.join(ROOT, 'DESIGN.md');

const TOKENS_START = '<!-- BEGIN:generated tokens -->';
const TOKENS_END = '<!-- END:generated tokens -->';
const PRIMITIVES_START = '<!-- BEGIN:generated primitives -->';
const PRIMITIVES_END = '<!-- END:generated primitives -->';

function document(): string {
  return readFileSync(DESIGN, 'utf8');
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('UI-34: DESIGN.md generated blocks', () => {
  it('has both marker pairs exactly once', () => {
    const source = document();
    for (const marker of [TOKENS_START, TOKENS_END, PRIMITIVES_START, PRIMITIVES_END]) {
      expect(occurrences(source, marker), `marker ${marker}`).toBe(1);
    }
  });

  it('token block lists every palette × mode', () => {
    const block = renderTokenBlock();
    for (const header of ['Indigo light', 'Indigo dark', 'Petrol light', 'Petrol dark', 'Copper light', 'Copper dark']) {
      expect(block).toContain(header);
    }
    // A silently empty parse would still "match" the document — forbid it.
    expect(block).toContain('`--accent`');
    expect(block).toContain('`--text-13`');
    expect(block.split('\n').length).toBeGreaterThan(30);
  });

  it('primitive block lists the renderable exports only', () => {
    const block = renderPrimitivesBlock();
    expect(block).toContain('`Button`');
    expect(block).toContain('`Dialog`');
    expect(block).toContain('`EmptyState`');
    // Prop types are not primitives.
    expect(block).not.toContain('`ButtonProps`');
    expect(block).not.toContain('`DialogProps`');
  });

  it('matches the committed DESIGN.md (run `npm run design:doc`)', () => {
    const source = document();
    const expected = renderDesignDoc(source);
    const message =
      'DESIGN.md устарел: сгенерированные блоки расходятся с кодом. ' +
      'Запусти `npm run design:doc` и закоммить результат.';
    expect(source === expected ? 'up to date' : 'stale', message).toBe('up to date');
  });
});
