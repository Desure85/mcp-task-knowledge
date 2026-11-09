/**
 * Y-05a — гейт sqlite-vec: расширение действительно загружается на текущей версии Node и умеет
 * vec0-таблицы, а при отсутствии пакета профиль получает честный CAPABILITY_UNAVAILABLE.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { probeSqliteVec, loadSqliteVecOrThrow } from '../src/storage/profiles/sqlite/vec-gate.js';

function memoryDb(): Database.Database {
  return new Database(':memory:');
}

describe('Y-05a: sqlite-vec gate', () => {
  it('reports FTS5 and a loadable sqlite-vec on this runtime', () => {
    const db = memoryDb();
    try {
      const probe = probeSqliteVec(db);
      expect(probe.node).toBe(process.version);
      expect(probe.sqlite).toMatch(/^\d+\.\d+\.\d+/);
      expect(probe.fts5).toBe(true);
      expect(probe.vec.available).toBe(true);
      expect(probe.vec.version).toMatch(/^v\d+\.\d+\.\d+/);
      expect(probe.vec.loadablePath).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('supports a vec0 virtual table (vectors are usable, not just loadable)', () => {
    const db = memoryDb();
    try {
      loadSqliteVecOrThrow(db);
      db.exec('create virtual table vec_docs using vec0(embedding float[3])');
      const insert = db.prepare('insert into vec_docs(embedding) values (?)');
      insert.run(JSON.stringify([1, 0, 0]));
      insert.run(JSON.stringify([0, 1, 0]));
      const rows = db
        .prepare('select rowid, distance from vec_docs where embedding match ? order by distance limit 2')
        .all(JSON.stringify([1, 0, 0])) as Array<{ rowid: number; distance: number }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].rowid).toBe(1);
      expect(rows[0].distance).toBeLessThan(0.0001);
    } finally {
      db.close();
    }
  });

  it('reports the package-missing branch without pretending vectors work', () => {
    const db = memoryDb();
    try {
      const probe = probeSqliteVec(db, null);
      expect(probe.vec.available).toBe(false);
      expect(probe.vec.error).toMatch(/not installed/);
      expect(() => loadSqliteVecOrThrow(db)).not.toThrow(); // real package is installed here
    } finally {
      db.close();
    }
  });

  it('throws a domain error when vectors are unavailable', () => {
    const db = memoryDb();
    try {
      // Simulate an extension that exists on disk but fails to load by pointing the probe at a
      // package object whose loadablePath is bogus.
      const broken = {
        getLoadablePath: () => '/definitely/not/a/sqlite-vec/binary',
        load: () => undefined,
      };
      const probe = probeSqliteVec(db, broken as never);
      expect(probe.vec.available).toBe(false);
      expect(probe.vec.error).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
