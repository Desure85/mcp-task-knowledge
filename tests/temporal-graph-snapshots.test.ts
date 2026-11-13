import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TemporalGraph } from '../src/memory/temporal-graph.js';

const dirs: string[] = [];
function temp(): { root: string; graphPath: string; snapshotDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'mu06-'));
  dirs.push(root);
  return { root, graphPath: join(root, 'temporal-graph.json'), snapshotDir: join(root, 'snaps') };
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('MU-06 temporal graph snapshots', () => {
  it('creates a snapshot on save when interval is zero', () => {
    const { graphPath, snapshotDir } = temp();
    const graph = new TemporalGraph({ storagePath: graphPath, snapshot: { dir: snapshotDir, intervalMs: 0 } });
    graph.addFact({ statement: 'snapshot fact one' });
    expect(readdirSync(snapshotDir).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('respects the interval and does not snapshot every write', () => {
    const { graphPath, snapshotDir } = temp();
    const graph = new TemporalGraph({ storagePath: graphPath, snapshot: { dir: snapshotDir, intervalMs: 60_000 } });
    graph.addFact({ statement: 'first' });
    graph.addFact({ statement: 'second' });
    expect(readdirSync(snapshotDir)).toHaveLength(1);
  });

  it('keeps only the newest N snapshots', () => {
    const { graphPath, snapshotDir } = temp();
    const graph = new TemporalGraph({ storagePath: graphPath, snapshot: { dir: snapshotDir, intervalMs: 0, keep: 2 } });
    for (let i = 0; i < 5; i++) graph.addFact({ statement: `fact ${i}` });
    const files = readdirSync(snapshotDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(2);
  });
});
