import { describe, it, expect } from 'vitest';

import { pickWithEpsilonGreedy } from '../src/ab-testing/bandits.js';

describe('epsilon-greedy bandit', () => {
  it('falls back to random among given variants when no stats', () => {
    const variants = ['A', 'B', 'C'];
    const stats = {} as any;
    const v = pickWithEpsilonGreedy(variants, stats, { epsilon: 0 });
    expect(variants.includes(v)).toBe(true);
  });

  it('prefers higher avg score when epsilon=0', () => {
    const variants = ['A', 'B'];
    const stats: any = {
      A: { trials: 10, successes: 3, scoreSum: 3.0, latencySumMs: 0, costSum: 0, tokensInSum: 0, tokensOutSum: 0 }, // avg=0.3
      B: { trials: 10, successes: 4, scoreSum: 7.0, latencySumMs: 0, costSum: 0, tokensInSum: 0, tokensOutSum: 0 }, // avg=0.7
    };
    const v = pickWithEpsilonGreedy(variants, stats, { epsilon: 0 });
    expect(v).toBe('B');
  });

  it('uses success rate when no score present', () => {
    const variants = ['A', 'B'];
    const stats: any = {
      A: { trials: 10, successes: 3, scoreSum: 0, latencySumMs: 0, costSum: 0, tokensInSum: 0, tokensOutSum: 0 }, // avgScore=0 => metric=successRate=0.3
      B: { trials: 10, successes: 4, scoreSum: 0, latencySumMs: 0, costSum: 0, tokensInSum: 0, tokensOutSum: 0 }, // 0.4
    };
    const v = pickWithEpsilonGreedy(variants, stats, { epsilon: 0 });
    expect(v).toBe('B');
  });
});
