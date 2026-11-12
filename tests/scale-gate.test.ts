import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../scripts/bench/gate-scale.mjs';

const baseline = { ops: { tasks_list: { medianMs: 28 }, knowledge_list: { medianMs: 33 } }, coldStartMs: 967, caps: { tasks_list: 500, knowledge_list: 500, coldStartMs: 5000 } };

function result(tasks = 28, knowledge = 33, coldStartMs = 967) {
  return {
    ok: true,
    coldStartMs,
    ops: {
      tasks_list: { status: 'ok', medianMs: tasks },
      knowledge_list: { status: 'ok', medianMs: knowledge },
    },
  };
}

describe('SC-08 scale gate', () => {
  it('passes when medians are at baseline', () => {
    expect(evaluateGate(result(), baseline)).toMatchObject({ ok: true, violations: [] });
  });

  it('fails when listTasks regresses by more than 2x', () => {
    const gate = evaluateGate(result(57), baseline);
    expect(gate.ok).toBe(false);
    expect(gate.violations).toContainEqual(expect.objectContaining({ op: 'tasks_list', reason: expect.stringContaining('2x baseline') }));
  });

  it('fails on an absolute cap, missing op and cold start', () => {
    const cap = evaluateGate(result(600, 33), baseline);
    expect(cap.ok).toBe(false);
    expect(cap.violations.some((v: { reason: string }) => v.reason.includes('cap 500'))).toBe(true);

    const missing = evaluateGate({ ...result(), ops: { tasks_list: { status: 'ok', medianMs: 28 } } }, baseline);
    expect(missing.violations).toContainEqual(expect.objectContaining({ op: 'knowledge_list', reason: expect.stringContaining('missing') }));

    const cold = evaluateGate(result(28, 33, 6000), baseline);
    expect(cold.violations).toContainEqual(expect.objectContaining({ op: 'coldStartMs' }));
  });
});
