/**
 * Y-03b — файловое хранилище векторов с адресацией по коллекциям.
 *
 * ADR-009: коллекция адресуется `отпечаток + версия стратегии чанкинга + версия сборки текста`;
 * смешивать векторы разных коллекций нельзя. Файловый профиль — brute force по коллекции: раскладка
 * `vectors/<collectionId>/<key>.json`, один JSON на вектор (вектор — массив чисел). Это осознанно
 * простое решение для файлового профиля; ANN-структуры появятся в SQLite/Postgres (Y-05/Y-06).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type VectorCollectionInfo,
  type VectorMatch,
  type VectorQueryOptions,
  type VectorRecord,
  type VectorStore,
} from './contracts.js';

export interface FileVectorStoreOptions {
  /** Caller-owned root (ADR-009 rule 1); nothing here knows about `DATA_DIR`. */
  root: string;
}

export interface FileVectorStore extends VectorStore {
  collections(): Promise<VectorCollectionInfo[]>;
}

interface StoredVector extends VectorRecord {
  collection: string;
}

function identityKey(store: string, kind: string, id: string): string {
  return createHash('sha1').update(`${store}|${kind}|${id}`).digest('hex');
}

function recordKey(record: Pick<VectorRecord, 'store' | 'kind' | 'id'>): string {
  return identityKey(record.store, record.kind, record.id);
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
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

export function createFileVectorStore(options: FileVectorStoreOptions): FileVectorStore {
  const root = path.resolve(options.root);
  // Collection ids carry '|', ':' and spaces (fingerprint + version strings), which are illegal in
  // Windows paths, so the directory name is a hash while the descriptor keeps the real id.
  const collectionDir = (collection: string) =>
    path.join(root, createHash('sha1').update(collection).digest('hex'));
  // Iterating the root already yields directory names; hashing them again would point nowhere.
  const dirPath = (directoryName: string) => path.join(root, directoryName);

  async function ensureCollection(collection: string, descriptor: VectorCollectionInfo): Promise<void> {
    const dir = collectionDir(collection);
    await fs.mkdir(dir, { recursive: true });
    const metaFile = path.join(dir, 'collection.json');
    try {
      await fs.access(metaFile);
    } catch {
      const stored = {
        id: collection,
        fingerprint: descriptor.fingerprint,
        chunkingVersion: descriptor.chunkingVersion,
        buildTextVersion: descriptor.buildTextVersion,
        readOnly: descriptor.readOnly,
      };
      await fs.writeFile(metaFile, JSON.stringify(stored, null, 2), 'utf8');
    }
  }

  async function collectionEntries(collection: string): Promise<StoredVector[]> {
    const dir = collectionDir(collection);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const records: StoredVector[] = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'collection.json') continue;
      const parsed = (await readJson(path.join(dir, name))) as StoredVector | undefined;
      if (parsed && Array.isArray(parsed.vector)) {
        records.push({ ...parsed, vector: Float32Array.from(parsed.vector) });
      }
    }
    return records;
  }

  return {
    async upsert(records: VectorRecord[]): Promise<void> {
      for (const record of records) {
        const target = record.collection;
        const descriptor: VectorCollectionInfo = {
          id: target,
          fingerprint: record.fingerprint,
          chunkingVersion: record.collectionMeta?.chunkingVersion ?? 'unknown',
          buildTextVersion: record.collectionMeta?.buildTextVersion ?? 'unknown',
          vectors: 0,
          active: true,
          readOnly: false,
        };
        await ensureCollection(target, descriptor);
        const file = path.join(collectionDir(target), `${recordKey(record)}.json`);
        await fs.writeFile(
          file,
          JSON.stringify({
            store: record.store,
            kind: record.kind,
            project: record.project,
            id: record.id,
            fingerprint: record.fingerprint,
            collection: target,
            vector: Array.from(record.vector),
          }),
          'utf8',
        );
      }
    },

    async delete(store: string, kind: VectorRecord['kind'], ids: string[]): Promise<void> {
      let names: string[];
      try {
        names = await fs.readdir(root);
      } catch {
        return;
      }
      for (const name of names) {
        const dir = dirPath(name);
        for (const id of ids) {
          await fs.rm(path.join(dir, `${identityKey(store, kind, id)}.json`), { force: true });
        }
      }
    },

    async query(vector: Float32Array, options: VectorQueryOptions): Promise<VectorMatch[]> {
      const collection = options.collection ?? options.fingerprint;
      const records = await collectionEntries(collection);
      const matches: VectorMatch[] = [];
      for (const record of records) {
        if (options.project && record.project !== options.project) continue;
        if (options.kind && record.kind !== options.kind) continue;
        if (record.fingerprint !== options.fingerprint) continue;
        const score = cosine(vector, record.vector);
        if (options.minScore !== undefined && score < options.minScore) continue;
        matches.push({
          store: record.store,
          kind: record.kind,
          project: record.project,
          id: record.id,
          score,
          fingerprint: record.fingerprint,
        });
      }
      matches.sort((left, right) => right.score - left.score);
      return options.limit ? matches.slice(0, options.limit) : matches;
    },

    async stats(fingerprint?: string): Promise<{ collections: Record<string, number>; total: number }> {
      const collections = await this.collections();
      const counts: Record<string, number> = {};
      let total = 0;
      for (const info of collections) {
        if (fingerprint && info.fingerprint !== fingerprint) continue;
        counts[info.id] = info.vectors;
        total += info.vectors;
      }
      return { collections: counts, total };
    },

    async clear(options?: { fingerprint?: string }): Promise<void> {
      const collections = await this.collections();
      for (const info of collections) {
        if (options?.fingerprint && info.fingerprint !== options.fingerprint) continue;
        await fs.rm(collectionDir(info.id), { recursive: true, force: true });
      }
    },

    async collections(): Promise<VectorCollectionInfo[]> {
      let names: string[];
      try {
        names = await fs.readdir(root);
      } catch {
        return [];
      }
      const infos: VectorCollectionInfo[] = [];
      for (const name of names) {
        const dir = dirPath(name);
        let stats;
        try {
          stats = await fs.stat(dir);
        } catch {
          continue;
        }
        if (!stats.isDirectory()) continue;
        const descriptor = (await readJson(path.join(dir, 'collection.json'))) as
          | Pick<VectorCollectionInfo, 'fingerprint' | 'chunkingVersion' | 'buildTextVersion' | 'readOnly'>
          | undefined;
        if (!descriptor) continue;
        const collection = (descriptor as { id?: string }).id ?? name;
        const vectors = await collectionEntries(collection);
        infos.push({
          id: collection,
          fingerprint: descriptor.fingerprint,
          chunkingVersion: descriptor.chunkingVersion,
          buildTextVersion: descriptor.buildTextVersion,
          vectors: vectors.length,
          active: false,
          readOnly: Boolean(descriptor.readOnly),
        });
      }
      return infos.sort((left, right) => left.id.localeCompare(right.id));
    },
  };
}
