/**
 * Y-07a — файловый `BlobProvider` для вложений, экспортов и копий.
 *
 * Адресация ключом, а не путём: `root` передаёт вызывающий (ADR-009 rule 1), ключ валидируется
 * (никаких `..`, абсолютных путей, обратных слэшей) и резолвится только внутри `root`. Запись
 * атомарная (temp + rename), метаданные (checksum/contentType) — в скрытом каталоге `.meta`,
 * поэтому список блобов не зависит от побочных файлов. Отсутствующий ключ — `StoreError('NOT_FOUND')`,
 * а не пустые байты: вызывающий обязан отличать «нет объекта» от «объект пустой».
 */

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  StoreError,
  type BlobMetadata,
  type BlobProvider,
  type BlobPutOptions,
} from '../contracts.js';

export interface FileBlobProviderOptions {
  root: string;
  /** Optional ceiling; larger payloads are rejected with `CONFLICT` before touching the disk. */
  maxBytes?: number;
}

const KEY_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const META_DIR = '.meta';
const TMP_PREFIX = '.tmp-';

function checksumOf(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

export function assertValidBlobKey(key: string): void {
  const fail = (reason: string): never => {
    throw new StoreError('CONFLICT', `invalid blob key (${reason})`, { key });
  };
  if (typeof key !== 'string' || key.length === 0) fail('empty');
  if (key.length > 512) fail('longer than 512 characters');
  if (key.startsWith('/') || key.endsWith('/')) fail('leading or trailing slash');
  for (const segment of key.split('/')) {
    if (segment === '.' || segment === '..') fail('relative path segment');
    if (!KEY_SEGMENT_RE.test(segment)) fail(`segment "${segment}" has characters outside [A-Za-z0-9._-]`);
  }
}

export function createFileBlobProvider(options: FileBlobProviderOptions): BlobProvider {
  const root = path.resolve(options.root);
  const metaRoot = path.join(root, META_DIR);

  function resolveBlobPath(key: string): string {
    assertValidBlobKey(key);
    const target = path.resolve(root, ...key.split('/'));
    if (target === root || !target.startsWith(root + path.sep)) {
      throw new StoreError('CONFLICT', 'invalid blob key (escapes the blob root)', { key });
    }
    return target;
  }

  function metaPath(key: string): string {
    return path.join(metaRoot, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  async function writeMeta(meta: BlobMetadata): Promise<void> {
    await fs.mkdir(metaRoot, { recursive: true });
    const file = metaPath(meta.key);
    const temp = path.join(metaRoot, `${TMP_PREFIX}${randomBytes(6).toString('hex')}.json`);
    await fs.writeFile(temp, JSON.stringify(meta), 'utf8');
    await fs.rename(temp, file);
  }

  async function readMeta(key: string): Promise<BlobMetadata | undefined> {
    try {
      return JSON.parse(await fs.readFile(metaPath(key), 'utf8')) as BlobMetadata;
    } catch {
      return undefined;
    }
  }

  async function metadataFor(key: string, file: string): Promise<BlobMetadata> {
    const stored = await readMeta(key);
    if (stored) return stored;
    const data = await fs.readFile(file);
    const stat = await fs.stat(file);
    return { key, size: data.byteLength, checksum: checksumOf(data), updatedAt: stat.mtime.toISOString() };
  }

  async function walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const keys: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) keys.push(...(await walk(absolute)));
      else if (entry.isFile()) keys.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
    return keys;
  }

  return {
    kind: 'file',
    capabilities: { presign: false, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) },
    async put(key: string, data: Uint8Array, putOptions?: BlobPutOptions): Promise<BlobMetadata> {
      const target = resolveBlobPath(key);
      if (options.maxBytes !== undefined && data.byteLength > options.maxBytes) {
        throw new StoreError('CONFLICT', `blob exceeds maxBytes=${options.maxBytes}`, {
          key,
          size: data.byteLength,
        });
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = path.join(path.dirname(target), `${TMP_PREFIX}${randomBytes(8).toString('hex')}`);
      try {
        await fs.writeFile(temp, data);
        await fs.rename(temp, target);
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        throw new StoreError('CONFLICT', `failed to store blob: ${(error as Error).message}`, { key });
      }
      const meta: BlobMetadata = {
        key,
        size: data.byteLength,
        checksum: checksumOf(data),
        ...(putOptions?.contentType === undefined ? {} : { contentType: putOptions.contentType }),
        updatedAt: new Date().toISOString(),
      };
      await writeMeta(meta);
      return meta;
    },
    async get(key: string): Promise<Uint8Array> {
      const target = resolveBlobPath(key);
      try {
        return new Uint8Array(await fs.readFile(target));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new StoreError('NOT_FOUND', `blob not found: ${key}`, { key });
        }
        throw new StoreError('CONFLICT', `failed to read blob: ${(error as Error).message}`, { key });
      }
    },
    async size(key: string): Promise<number> {
      const target = resolveBlobPath(key);
      try {
        return (await fs.stat(target)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new StoreError('NOT_FOUND', `blob not found: ${key}`, { key });
        }
        throw new StoreError('CONFLICT', `failed to stat blob: ${(error as Error).message}`, { key });
      }
    },
    async delete(key: string): Promise<boolean> {
      const target = resolveBlobPath(key);
      try {
        await fs.unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw new StoreError('CONFLICT', `failed to delete blob: ${(error as Error).message}`, { key });
      }
      await fs.rm(metaPath(key), { force: true }).catch(() => undefined);
      return true;
    },
    async list(prefix?: string): Promise<BlobMetadata[]> {
      const rootExists = await fs.stat(root).catch(() => undefined);
      if (!rootExists) return [];
      const keys = (await walk(root)).filter((key) => (prefix ? key.startsWith(prefix) : true)).sort();
      const blobs: BlobMetadata[] = [];
      for (const key of keys) {
        // A file that appeared without going through put() still gets honest metadata.
        try {
          blobs.push(await metadataFor(key, path.join(root, ...key.split('/'))));
        } catch {
          // Deleted between walk and stat: the listing is a snapshot, not a transaction.
        }
      }
      return blobs;
    },
  };
}
