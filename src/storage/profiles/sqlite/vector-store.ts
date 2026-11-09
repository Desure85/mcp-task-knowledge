/**
 * Y-05b2 — VectorStore SQLite-профиля.
 *
 * Векторы адресуются коллекцией (`collectionId`: отпечаток+чанкинг+buildText) и хранятся в той же
 * SQLite-БД. При доступном `sqlite-vec` поиск идёт через vec0-таблицу на коллекцию (ANN), иначе —
 * детерминированный brute-force по сохранённым векторам. Именно поэтому недоступность расширения не
 * превращается в «пустой поиск»: capability `vectors` остаётся true, а `annAvailable()` честно говорит,
 * какой путь используется. Scores всегда пересчитываются точным косинусом по исходным векторам —
 * ANN — это только отбор кандидатов, а не источник оценки.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { StoreError } from '../../contracts.js';
import type {
  VectorCollectionInfo,
  VectorMatch,
  VectorQueryOptions,
  VectorRecord,
  VectorStore,
} from '../../../search/contracts.js';

export interface SqliteVectorStore extends VectorStore {
  collections(): Promise<VectorCollectionInfo[]>;
  /** True when ANN queries go through `sqlite-vec`; false means brute-force cosine fallback. */
  annAvailable(): boolean;
}

interface VectorRow {
  collection: string;
  store: string;
  kind: VectorRecord['kind'];
  project: string;
  id: string;
  fingerprint: string;
  vector: string;
}

function vectorTable(collection: string): string {
  return `vec_${createHash('sha1').update(collection).digest('hex').slice(0, 16)}`;
}

function toArray(vector: Float32Array | number[]): number[] {
  return Array.from(vector as ArrayLike<number>);
}

function normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? values.map((value) => value / norm) : values.slice();
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function createSqliteVectorStore(input: {
  db: Database.Database;
  vecAvailable: boolean;
}): SqliteVectorStore {
  const { db } = input;
  let vecReady = input.vecAvailable;

  const selectCollection = db.prepare(
    'select collection, fingerprint, chunking_version, build_text_version, dimension, active, read_only, created_at from vector_collections where collection = ?',
  );
  const selectCollections = db.prepare(
    'select collection, fingerprint, chunking_version, build_text_version, dimension, active, read_only, created_at from vector_collections order by created_at, collection',
  );
  const insertCollection = db.prepare(
    'insert into vector_collections(collection, fingerprint, chunking_version, build_text_version, dimension, active, read_only, created_at) values(?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const deactivateAll = db.prepare('update vector_collections set active = 0, read_only = 1');
  const activateCollection = db.prepare('update vector_collections set active = 1, read_only = 0 where collection = ?');
  const upsertVectorRow = db.prepare(
    'insert into vector_rows(collection, store, kind, project, id, fingerprint, vector) values(?, ?, ?, ?, ?, ?, ?) on conflict(collection, store, kind, project, id) do update set fingerprint = excluded.fingerprint, vector = excluded.vector',
  );
  const deleteVectorRow = db.prepare(
    'delete from vector_rows where collection = ? and store = ? and kind = ? and project = ? and id = ?',
  );
  const deleteVectorRowsByIds = db.prepare(
    'delete from vector_rows where collection = ? and store = ? and kind = ? and project = ? and id = ?',
  );
  const selectRowsByCollection = db.prepare(
    'select collection, store, kind, project, id, fingerprint, vector from vector_rows where collection = ?',
  );
  const selectCollectionsByIdentity = db.prepare(
    'select distinct collection from vector_rows where store = ? and kind = ? and project = ? and id = ?',
  );
  const selectMapping = db.prepare(
    'select vec_rowid from vector_keys where collection = ? and store = ? and kind = ? and project = ? and id = ?',
  );
  const insertMapping = db.prepare(
    'insert into vector_keys(collection, vec_rowid, store, kind, project, id) values(?, ?, ?, ?, ?, ?)',
  );
  const updateMapping = db.prepare(
    'update vector_keys set vec_rowid = ? where collection = ? and store = ? and kind = ? and project = ? and id = ?',
  );
  const deleteMapping = db.prepare(
    'delete from vector_keys where collection = ? and store = ? and kind = ? and project = ? and id = ?',
  );
  const deleteMappingsForCollection = db.prepare('delete from vector_keys where collection = ?');
  const selectAllMappings = db.prepare(
    'select vec_rowid, store, kind, project, id from vector_keys where collection = ?',
  );
  const countRows = db.prepare('select count(*) as total from vector_rows where collection = ?');
  const insertVectorRowId = db.prepare(
    'insert into vector_rows(collection, store, kind, project, id, fingerprint, vector) values(?, ?, ?, ?, ?, ?, ?) on conflict(collection, store, kind, project, id) do update set fingerprint = excluded.fingerprint, vector = excluded.vector',
  );

  function ensureVecTable(collection: string, dimension: number): string {
    const table = vectorTable(collection);
    if (!vecReady) return table;
    try {
      db.exec(`create virtual table if not exists "${table}" using vec0(embedding float[${dimension}])`);
    } catch {
      vecReady = false;
    }
    return table;
  }

  function collectionDimension(collection: string): number | null {
    const row = selectCollection.get(collection) as { dimension: number } | undefined;
    return row ? row.dimension : null;
  }

  async function upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    db.transaction(() => {
      deactivateAll.run();
      for (const record of records) {
        const values = toArray(record.vector);
        const existing = selectCollection.get(record.collection) as { dimension: number } | undefined;
        if (existing && existing.dimension !== values.length) {
          throw new StoreError(
            'CONFLICT',
            `vector dimension ${values.length} does not match collection ${record.collection} (${existing.dimension})`,
          );
        }
        if (!existing) {
          insertCollection.run(
            record.collection,
            record.fingerprint,
            record.collectionMeta?.chunkingVersion ?? 'unknown',
            record.collectionMeta?.buildTextVersion ?? 'unknown',
            values.length,
            1,
            0,
            new Date().toISOString(),
          );
        }
        activateCollection.run(record.collection);
        insertVectorRowId.run(
          record.collection,
          record.store,
          record.kind,
          record.project,
          record.id,
          record.fingerprint,
          JSON.stringify(values),
        );
        if (vecReady) {
          const table = ensureVecTable(record.collection, values.length);
          const mapped = selectMapping.get(record.collection, record.store, record.kind, record.project, record.id) as
            | { vec_rowid: number }
            | undefined;
          const normalized = JSON.stringify(normalize(values));
          try {
            if (mapped) {
              db.prepare(`update "${table}" set embedding = ? where rowid = ?`).run(normalized, mapped.vec_rowid);
            } else {
              const info = db.prepare(`insert into "${table}"(embedding) values (?)`).run(normalized);
              insertMapping.run(
                record.collection,
                Number(info.lastInsertRowid),
                record.store,
                record.kind,
                record.project,
                record.id,
              );
            }
          } catch {
            vecReady = false;
          }
        }
      }
    })();
  }

  const store: SqliteVectorStore = {
    upsert,
    async delete(storeId: string, kind: VectorRecord['kind'], ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      db.transaction(() => {
        for (const id of ids) {
          const identities = db
            .prepare('select collection, project from vector_rows where store = ? and kind = ? and id = ?')
            .all(storeId, kind, id) as Array<{ collection: string; project: string }>;
          for (const identity of identities) {
            if (vecReady) {
              const mapped = selectMapping.get(identity.collection, storeId, kind, identity.project, id) as
                | { vec_rowid: number }
                | undefined;
              if (mapped) {
                try {
                  db.prepare('delete from "' + vectorTable(identity.collection) + '" where rowid = ?').run(mapped.vec_rowid);
                } catch {
                  vecReady = false;
                }
                deleteMapping.run(identity.collection, storeId, kind, identity.project, id);
              }
            }
            deleteVectorRow.run(identity.collection, storeId, kind, identity.project, id);
          }
        }
      })();
    },
    async query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorMatch[]> {
      const limit = Math.max(1, options.limit ?? 10);
      const queryVector = normalize(toArray(vector));
      const collections = (selectCollections.all() as Array<{ collection: string; fingerprint: string; dimension: number }>)
        .filter((row) => row.fingerprint === options.fingerprint)
        .filter((row) => !options.collection || row.collection === options.collection);
      const matches: VectorMatch[] = [];
      for (const collectionRow of collections) {
        const rows = selectRowsByCollection.all(collectionRow.collection) as VectorRow[];
        if (rows.length === 0) continue;
        const dimensionMatches = collectionRow.dimension === queryVector.length;
        if (vecReady && dimensionMatches) {
          const table = vectorTable(collectionRow.collection);
          try {
            const candidates = db
              .prepare(`select rowid as vec_rowid from "${table}" where embedding match ? order by distance limit ?`)
              .all(JSON.stringify(queryVector), Math.max(limit * 8, 32)) as Array<{ vec_rowid: number }>;
            const byRowid = new Map<number, VectorRow>();
            for (const candidate of candidates) {
              const key = db
                .prepare('select store, kind, project, id from vector_keys where collection = ? and vec_rowid = ?')
                .get(collectionRow.collection, candidate.vec_rowid) as
                | { store: string; kind: VectorRecord['kind']; project: string; id: string }
                | undefined;
              if (!key) continue;
              const mapping = db
                .prepare(
                  'select collection, store, kind, project, id, fingerprint, vector from vector_rows where collection = ? and store = ? and kind = ? and project = ? and id = ?',
                )
                .get(collectionRow.collection, key.store, key.kind, key.project, key.id) as VectorRow | undefined;
              if (mapping) byRowid.set(candidate.vec_rowid, mapping);
            }
            for (const row of byRowid.values()) {
              if (options.project && row.project !== options.project) continue;
              if (options.kind && row.kind !== options.kind) continue;
              matches.push({
                store: row.store,
                kind: row.kind,
                project: row.project,
                id: row.id,
                fingerprint: row.fingerprint,
                score: cosine(queryVector, JSON.parse(row.vector) as number[]),
              });
            }
          } catch {
            vecReady = false;
          }
        }
        if (!vecReady || !dimensionMatches) {
          for (const row of rows) {
            if (options.project && row.project !== options.project) continue;
            if (options.kind && row.kind !== options.kind) continue;
            matches.push({
              store: row.store,
              kind: row.kind,
              project: row.project,
              id: row.id,
              fingerprint: row.fingerprint,
              score: cosine(queryVector, JSON.parse(row.vector) as number[]),
            });
          }
        }
      }
      return matches
        .filter((match) => options.minScore === undefined || match.score >= options.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
    async stats(fingerprint?: string): Promise<{ collections: Record<string, number>; total: number }> {
      const collections = (selectCollections.all() as Array<{ collection: string; fingerprint: string }>).filter(
        (row) => !fingerprint || row.fingerprint === fingerprint,
      );
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of collections) {
        const count = (countRows.get(row.collection) as { total: number }).total;
        counts[row.collection] = count;
        total += count;
      }
      return { collections: counts, total };
    },
    async clear(options?: { fingerprint?: string }): Promise<void> {
      const collections = (selectCollections.all() as Array<{ collection: string; fingerprint: string }>).filter(
        (row) => !options?.fingerprint || row.fingerprint === options.fingerprint,
      );
      db.transaction(() => {
        for (const row of collections) {
          if (vecReady) {
            try {
              db.exec(`drop table if exists "${vectorTable(row.collection)}"`);
            } catch {
              vecReady = false;
            }
          }
          deleteMappingsForCollection.run(row.collection);
          db.prepare('delete from vector_rows where collection = ?').run(row.collection);
          db.prepare('delete from vector_collections where collection = ?').run(row.collection);
        }
      })();
    },
    async collections(): Promise<VectorCollectionInfo[]> {
      return (selectCollections.all() as Array<{
        collection: string;
        fingerprint: string;
        chunking_version: string;
        build_text_version: string;
        active: number;
        read_only: number;
      }>).map((row) => ({
        id: row.collection,
        fingerprint: row.fingerprint,
        chunkingVersion: row.chunking_version,
        buildTextVersion: row.build_text_version,
        vectors: (countRows.get(row.collection) as { total: number }).total,
        active: row.active === 1,
        readOnly: row.read_only === 1,
      }));
    },
    annAvailable: () => vecReady,
  };
  return store;
}
