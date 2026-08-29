/**
 * behavioral/dashboard.spec.ts — Tests for behavioral dashboard (BM-011).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehavioralDashboard } from './dashboard.js';

describe('BM-011: BehavioralDashboard', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bm11-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seed() {
    const now = Date.now();
    const day = 86_400_000;
    const intents = [
      { memoryId: 'i1', prompt: 'fix bug', file: 'a.ts', contentHash: 'h1', timestamp: new Date(now - day).toISOString(), context: {} },
      { memoryId: 'i2', prompt: 'add feature', file: 'b.ts', contentHash: 'h2', timestamp: new Date(now - 2 * day).toISOString(), context: {} },
      { memoryId: 'i3', prompt: 'refactor', file: 'c.ts', contentHash: 'h3', timestamp: new Date(now - 3 * day).toISOString(), context: {} },
    ];
    const failures = [
      { failureId: 'f1', memoryId: 'i1', errorType: 'TypeError', message: 'x undefined', context: {}, timestamp: new Date(now - day).toISOString() },
    ];
    const resolutions = [
      { resolutionId: 'r1', failureId: 'f1', fixingMemoryId: 'i1', approach: 'null-check', commitSha: 'abc123', timestamp: new Date(now - day).toISOString() },
      { resolutionId: 'r2', failureId: 'f2', fixingMemoryId: 'i2', approach: 'null-check', timestamp: new Date(now - 2 * day).toISOString() },
    ];
    writeFileSync(join(dir, 'intents.json'), JSON.stringify(intents));
    writeFileSync(join(dir, 'failures.json'), JSON.stringify(failures));
    writeFileSync(join(dir, 'resolutions.json'), JSON.stringify(resolutions));
  }

  it('computes totals from behavioral stores', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir });
    const data = dash.compute();
    expect(data.totals.intents).toBe(3);
    expect(data.totals.failures).toBe(1);
    expect(data.totals.resolutions).toBe(2);
    expect(data.totals.errorRate).toBeCloseTo(1 / 3);
  });

  it('builds a 90-day trend with correct bucket counts', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir, trendDays: 90 });
    const data = dash.compute();
    expect(data.trends).toHaveLength(90);
    const todayKey = new Date().toISOString().slice(0, 10);
    const yesterdayKey = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const today = data.trends.find((t) => t.date === todayKey);
    const yesterday = data.trends.find((t) => t.date === yesterdayKey);
    expect(today).toBeDefined();
    expect(yesterday).toBeDefined();
    // Intent i2 (2 days ago) and i3 (3 days ago) may fall outside 90d only if window shorter
    expect(yesterday!.intents).toBeGreaterThanOrEqual(1);
  });

  it('groups fix effectiveness by approach with commitSha as resolved', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir });
    const data = dash.compute();
    const nc = data.approaches.find((a) => a.approach === 'null-check');
    expect(nc).toBeDefined();
    expect(nc!.total).toBe(2);
    expect(nc!.resolved).toBe(1); // only r1 has commitSha
    expect(nc!.successRate).toBe(0.5);
  });

  it('sorts approaches by total descending', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir });
    const data = dash.compute();
    for (let i = 1; i < data.approaches.length; i++) {
      expect(data.approaches[i - 1].total).toBeGreaterThanOrEqual(data.approaches[i].total);
    }
  });

  it('builds event timeline newest-first with kinds', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir });
    const data = dash.compute();
    expect(data.timeline.length).toBeGreaterThanOrEqual(6);
    const kinds = new Set(data.timeline.map((e) => e.kind));
    expect(kinds.has('intent')).toBe(true);
    expect(kinds.has('failure')).toBe(true);
    expect(kinds.has('resolution')).toBe(true);
    for (let i = 1; i < data.timeline.length; i++) {
      expect(data.timeline[i - 1].ts >= data.timeline[i].ts).toBe(true);
    }
  });

  it('handles missing stores gracefully (empty data)', () => {
    const dash = new BehavioralDashboard({ storagePath: join(dir, 'nonexistent') });
    const data = dash.compute();
    expect(data.totals.intents).toBe(0);
    expect(data.totals.failures).toBe(0);
    expect(data.totals.errorRate).toBe(0);
    expect(data.trends).toHaveLength(90);
    expect(data.timeline).toEqual([]);
  });

  it('handles corrupt JSON gracefully', () => {
    writeFileSync(join(dir, 'intents.json'), '{not json');
    const dash = new BehavioralDashboard({ storagePath: dir });
    const data = dash.compute();
    expect(data.totals.intents).toBe(0);
  });

  it('renders self-contained HTML with embedded data', () => {
    seed();
    const dash = new BehavioralDashboard({ storagePath: dir });
    const html = dash.toHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Behavioral Dashboard');
    expect(html).toContain('setInterval(render, 30000)');
    expect(html).toContain('"intents":3');
    expect(html).toContain('null-check');
    // Zero external deps: no http(s) references for assets
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
  });
});
