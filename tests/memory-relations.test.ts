import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRelations, RelationError } from '../src/memory/relations.js';
import { TemporalGraph } from '../src/memory/temporal-graph.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-memory-relations');
beforeAll(() => { fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true }); });
afterAll(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

describe('UI-29 typed relations', () => {
  it('validates, trims and dedupes', () => {
    expect(normalizeRelations([
      { subject: ' API ', predicate: 'uses', object: 'DB' },
      { subject: 'API', predicate: 'uses', object: 'DB' },
    ])).toEqual([{ subject: 'API', predicate: 'uses', object: 'DB' }]);
  });

  it('rejects unknown predicates and self relations', () => {
    expect(() => normalizeRelations([{ subject: 'A', predicate: 'likes', object: 'B' }])).toThrow(RelationError);
    expect(() => normalizeRelations([{ subject: 'A', predicate: 'uses', object: 'A' }])).toThrow(RelationError);
  });

  it('persists relations and migrates old facts without the field', () => {
    const graphPath = path.join(ROOT, 'graph.json');
    const graph = new TemporalGraph({ storagePath: graphPath });
    const fact = graph.addFact({ statement: 'API uses PostgreSQL', relations: [{ subject: 'API', predicate: 'uses', object: 'PostgreSQL' }] });
    expect(fact.relations).toHaveLength(1);
    const reloaded = new TemporalGraph({ storagePath: graphPath });
    expect(reloaded.getFact(fact.id)?.relations[0]).toEqual({ subject: 'API', predicate: 'uses', object: 'PostgreSQL' });

    const oldPath = path.join(ROOT, 'old.json');
    fs.writeFileSync(oldPath, JSON.stringify({ version: 1, facts: { old: { id: 'old', statement: 'legacy fact', category: 'fact', confidence: 0.5, tags: [], entities: [], validFrom: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:00.000Z', valid: true, relationships: [] } } }));
    const migrated = new TemporalGraph({ storagePath: oldPath });
    expect(migrated.getFact('old')?.relations).toEqual([]);
  });
});
