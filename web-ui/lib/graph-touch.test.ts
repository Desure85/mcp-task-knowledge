import { describe, expect, it } from 'vitest';
import { graphHitSize } from '../components/graph/GraphCanvas';

describe('UI-20 graph touch targets', () => {
  it('keeps the invisible node hit box at 44 screen pixels across viewBox/zoom', () => {
    for (const svgScale of [0.2, 0.35, 0.9, 1.4]) {
      for (const zoom of [0.5, 1, 2.5]) {
        expect(graphHitSize(svgScale, zoom) * svgScale * zoom).toBeCloseTo(44, 6);
      }
    }
  });

  it('never divides by a non-positive scale', () => {
    expect(graphHitSize(0, 0)).toBe(880);
  });
});
