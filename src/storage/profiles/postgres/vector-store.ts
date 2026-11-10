/**
 * Y-06b — VectorStore Postgres-профиля.
 *
 * Два пути, оба честно объявлены:
 * - `pgvector` доступен → на каждую коллекцию создаётся `vec_<sha1>` с `vector(N)` и HNSW-индексом
 *   (`vector_cosine_ops`); запрос идёт через `<=>`, а score всё равно пересчитывается точным косинусом
 *   по каноническим векторам из `vector_rows` (ANN — отбор кандидатов, не источник оценки).
 * - расширения нет → brute-force по `vector_rows` в приложении; `annAvailable()` возвращает false,
 *   `capabilities.vectors` остаётся true (хранение и поиск работают), и это видно в решении/доке.
 *
 * Канонические векторы хранятся в JSONB всегда, поэтому смена «есть pgvector / нет pgvector» не
 * теряет данные, а `vector_keys` связывает строку коллекции с rowid ANN-таблицы.
 */

import { createHash } from 'node:crypto';
import { StoreError } from '../../contracts.js';
import type {
  VectorCollectionInfo,
  VectorMatch,
  VectorQueryOptions,
  VectorRecord,
  VectorStore,
} from '../../../search/contracts.js';
import type { PostgresDatabase } from './db.js';

export interface PostgresVectorStore extends VectorStore {
  collections(): Promise<VectorCollectionInfo[]>;
  /** True when queries use pgvector ANN; false means exact cosine fallback over jsonb rows. */
  annAvailable(): boolean;
  annVersion(): string | null;
}

interface VectorRow {
  collection: string;
  store: string;
  kind: VectorRecord['kind'];
  project: string;
  id: string;
  fingerprint: string;
  embedding: number[];
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

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

export function createPostgresVectorStore(db: PostgresDatabase): PostgresVectorStore {
  const pool = db.pool;
  let ann = db.pgvector;
  const annVersion = db.pgvectorVersion;

  async function ensureAnnTable(client: import('pg').PoolClient, collection: string, dimension: number): Promise<string> {
    const table = vectorTable(collection);
    if (!ann) return table;
    try {
      await client.query(`create table if not exists "${table}" (id bigserial primary key, embedding vector(${dimension}))`);
      await client.query(
        `create index if not exists "${table}_hnsw" on "${table}" using hnsw (embedding vector_cosine_ops)`,
      );
    } catch {
      ann = false;
    }
    return table;
  }

  return {
    async upsert(records: VectorRecord[]): Promise<void> {
      if (records.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const record of records) {
          const values = toArray(record.vector);
          const existing = await client.query('select dimension from vector_collections where collection = $1', [
            record.collection,
          ]);
          if (existing.rows[0] && Number(existing.rows[0].dimension) !== values.length) {
            throw new StoreError(
              'CONFLICT',
              `vector dimension ${values.length} does not match collection ${record.collection} (${existing.rows[0].dimension})`,
              { collection: record.collection, expected: Number(existing.rows[0].dimension), actual: values.length },
            );
          }
          if (!existing.rows[0]) {
            await client.query(
              `insert into vector_collections(collection, fingerprint, chunking_version, build_text_version, dimension, active, read_only)
               values($1,$2,$3,$4,$5,true,false)`,
              [
                record.collection,
                record.fingerprint,
                record.collectionMeta?.chunkingVersion ?? 'unknown',
                record.collectionMeta?.buildTextVersion ?? 'unknown',
                values.length,
              ],
            );
          }
          await client.query('update vector_collections set active = false, read_only = true where collection <> $1', [
            record.collection,
          ]);
          await client.query('update vector_collections set active = true, read_only = false where collection = $1', [
            record.collection,
          ]);
          await client.query(
            `insert into vector_rows(collection, store, kind, project, id, fingerprint, embedding)
             values($1,$2,$3,$4,$5,$6,$7)
             on conflict(collection, store, kind, project, id) do update set fingerprint = excluded.fingerprint, embedding = excluded.embedding`,
            [record.collection, record.store, record.kind, record.project, record.id, record.fingerprint, JSON.stringify(values)],
          );
          if (ann) {
            const table = await ensureAnnTable(client, record.collection, values.length);
            if (ann) {
              try {
                const mapped = await client.query(
                  'select vec_id from vector_keys where collection=$1 and store=$2 and kind=$3 and project=$4 and id=$5',
                  [record.collection, record.store, record.kind, record.project, record.id],
                );
                const normalized = vectorLiteral(normalize(values));
                if (mapped.rows[0]) {
                  await client.query(`update "${table}" set embedding = $1::vector where id = $2`, [
                    normalized,
                    mapped.rows[0].vec_id,
                  ]);
                } else {
                  const inserted = await client.query(
                    `insert into "${table}"(embedding) values($1::vector) returning id`,
                    [normalized],
                  );
                  await client.query(
                    'insert into vector_keys(collection, vec_id, store, kind, project, id) values($1,$2,$3,$4,$5,$6)',
                    [record.collection, inserted.rows[0].id, record.store, record.kind, record.project, record.id],
                  );
                }
              } catch {
                ann = false;
              }
            }
          }
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async delete(storeId: string, kind: VectorRecord['kind'], ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const id of ids) {
          const identities = await client.query(
            'select collection, project from vector_rows where store=$1 and kind=$2 and id=$3',
            [storeId, kind, id],
          );
          for (const identity of identities.rows as Array<{ collection: string; project: string }>) {
            if (ann) {
              const mapped = await client.query(
                'select vec_id from vector_keys where collection=$1 and store=$2 and kind=$3 and project=$4 and id=$5',
                [identity.collection, storeId, kind, identity.project, id],
              );
              if (mapped.rows[0]) {
                try {
                  await client.query(`delete from "${vectorTable(identity.collection)}" where id = $1`, [
                    mapped.rows[0].vec_id,
                  ]);
                } catch {
                  ann = false;
                }
              }
            }
            await client.query(
              'delete from vector_keys where collection=$1 and store=$2 and kind=$3 and project=$4 and id=$5',
              [identity.collection, storeId, kind, identity.project, id],
            );
            await client.query(
              'delete from vector_rows where collection=$1 and store=$2 and kind=$3 and project=$4 and id=$5',
              [identity.collection, storeId, kind, identity.project, id],
            );
          }
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorMatch[]> {
      const limit = Math.max(1, options.limit ?? 10);
      const queryVector = normalize(toArray(vector));
      const collections = await pool.query(
        `select collection, fingerprint, dimension from vector_collections where fingerprint = $1
         ${options.collection ? 'and collection = $2' : ''}`,
        options.collection ? [options.fingerprint, options.collection] : [options.fingerprint],
      );
      const matches: VectorMatch[] = [];
      for (const collectionRow of collections.rows as Array<{ collection: string; dimension: number }>) {
        const rows = await pool.query('select collection, store, kind, project, id, fingerprint, embedding from vector_rows where collection = $1', [
          collectionRow.collection,
        ]);
        if (rows.rows.length === 0) continue;
        const dimensionMatches = Number(collectionRow.dimension) === queryVector.length;
        let candidates: VectorRow[] | null = null;
        if (ann && dimensionMatches) {
          try {
            const annRows = await pool.query(
              `select k.store, k.kind, k.project, k.id, r.collection, r.fingerprint,
                      r.embedding, t.embedding <=> $1::vector as distance
               from "${vectorTable(collectionRow.collection)}" t
               join vector_keys k on k.collection = $2 and k.vec_id = t.id
               join vector_rows r on r.collection = k.collection and r.store = k.store and r.kind = k.kind and r.project = k.project and r.id = k.id
               where k.collection = $2
               order by distance asc
               limit $3`,
              [vectorLiteral(queryVector), collectionRow.collection, Math.max(limit * 8, 32)],
            );
            candidates = annRows.rows.map((row) => ({
              collection: row.collection as string,
              store: row.store as string,
              kind: row.kind as VectorRecord['kind'],
              project: row.project as string,
              id: row.id as string,
              fingerprint: row.fingerprint as string,
              embedding: row.embedding as number[],
            }));
          } catch {
            ann = false;
            candidates = null;
          }
        }
        for (const row of candidates ?? (rows.rows as VectorRow[])) {
          if (options.project && row.project !== options.project) continue;
          if (options.kind && row.kind !== options.kind) continue;
          matches.push({
            store: row.store,
            kind: row.kind,
            project: row.project,
            id: row.id,
            fingerprint: row.fingerprint,
            score: cosine(queryVector, row.embedding as number[]),
          });
        }
      }
      return matches
        .filter((match) => options.minScore === undefined || match.score >= options.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
    async stats(fingerprint?: string): Promise<{ collections: Record<string, number>; total: number }> {
      const rows = await pool.query(
        `select collection from vector_collections ${fingerprint ? 'where fingerprint = $1' : ''}`,
        fingerprint ? [fingerprint] : [],
      );
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of rows.rows as Array<{ collection: string }>) {
        const count = await pool.query('select count(*)::int as total from vector_rows where collection = $1', [
          row.collection,
        ]);
        counts[row.collection] = count.rows[0].total as number;
        total += count.rows[0].total as number;
      }
      return { collections: counts, total };
    },
    async clear(options?: { fingerprint?: string }): Promise<void> {
      const rows = await pool.query(
        `select collection from vector_collections ${options?.fingerprint ? 'where fingerprint = $1' : ''}`,
        options?.fingerprint ? [options.fingerprint] : [],
      );
      for (const row of rows.rows as Array<{ collection: string }>) {
        if (ann) {
          try {
            await pool.query(`drop table if exists "${vectorTable(row.collection)}"`);
          } catch {
            ann = false;
          }
        }
        await pool.query('delete from vector_keys where collection = $1', [row.collection]);
        await pool.query('delete from vector_rows where collection = $1', [row.collection]);
        await pool.query('delete from vector_collections where collection = $1', [row.collection]);
      }
    },
    async collections(): Promise<VectorCollectionInfo[]> {
      const rows = await pool.query(
        'select collection, fingerprint, chunking_version, build_text_version, active, read_only from vector_collections order by created_at, collection',
      );
      const out: VectorCollectionInfo[] = [];
      for (const row of rows.rows) {
        const count = await pool.query('select count(*)::int as total from vector_rows where collection = $1', [
          row.collection,
        ]);
        out.push({
          id: row.collection as string,
          fingerprint: row.fingerprint as string,
          chunkingVersion: row.chunking_version as string,
          buildTextVersion: row.build_text_version as string,
          vectors: count.rows[0].total as number,
          active: row.active === true,
          readOnly: row.read_only === true,
        });
      }
      return out;
    },
    annAvailable: () => ann,
    annVersion: () => (ann ? annVersion : null),
  };
}
