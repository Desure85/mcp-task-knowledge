/**
 * Y-07a — общий контракт `BlobProvider` и файловая реализация.
 *
 * Набор вынесен в `runBlobProviderContract`, потому что Y-07b обязан прогнать через него
 * S3/MinIO-адаптер: один и тот же контракт, а не «похожие» тесты на каждый бэкенд.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileBlobProvider } from '../src/storage/blobs/file-blob-provider.js';
import type { BlobProvider } from '../src/storage/contracts.js';
import { createFileProfile } from '../src/storage/profiles/file/index.js';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';

const dirs: string[] = [];
const profiles: Array<ReturnType<typeof createSqliteProfile> | ReturnType<typeof createFileProfile>> = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-contract-'));
  dirs.push(dir);
  return dir;
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

afterEach(() => {
  for (const profile of profiles.splice(0)) profile.close?.();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sha256(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

/**
 * The contract every blob backend must satisfy. `create` is called once per test so each case gets
 * an isolated empty store; providers that cannot be reset get a fresh root/container instead.
 */
export function runBlobProviderContract(label: string, create: () => Promise<BlobProvider>): void {
  describe(`${label}: BlobProvider contract`, () => {
    it('round-trips binary payloads and reports metadata', async () => {
      const provider = await create();
      const payload = Uint8Array.from([0, 255, 1, 254, 2, 253, 0, 10, 13]);
      const meta = await provider.put('attachments/binary.bin', payload, { contentType: 'application/octet-stream' });
      expect(meta).toMatchObject({
        key: 'attachments/binary.bin',
        size: payload.byteLength,
        checksum: sha256(payload),
        contentType: 'application/octet-stream',
      });
      expect(await provider.get(meta.key)).toEqual(payload);
      expect(await provider.size(meta.key)).toBe(payload.byteLength);
    });

    it('is idempotent for identical bytes and overwrites on change', async () => {
      const provider = await create();
      const first = await provider.put('exports/report.json', bytes('{"a":1}'));
      const second = await provider.put('exports/report.json', bytes('{"a":1}'));
      expect(second.checksum).toBe(first.checksum);
      expect((await provider.list('exports/')).length).toBe(1);

      const changed = await provider.put('exports/report.json', bytes('{"a":2}'));
      expect(changed.checksum).not.toBe(first.checksum);
      expect(changed.size).toBe(bytes('{"a":2}').byteLength);
      expect(await provider.size('exports/report.json')).toBe(changed.size);
    });

    it('throws NOT_FOUND for a missing key instead of returning empty bytes', async () => {
      const provider = await create();
      await expect(provider.get('missing/none.bin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(provider.size('missing/none.bin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('deletes idempotently and lists keys by prefix in order', async () => {
      const provider = await create();
      await provider.put('b/second.txt', bytes('b'));
      await provider.put('a/first.txt', bytes('a'));
      await provider.put('a/nested/third.txt', bytes('c'));
      const all = await provider.list();
      expect(all.map((meta) => meta.key)).toEqual(['a/first.txt', 'a/nested/third.txt', 'b/second.txt']);
      expect((await provider.list('a/')).map((meta) => meta.key)).toEqual(['a/first.txt', 'a/nested/third.txt']);

      expect(await provider.delete('a/first.txt')).toBe(true);
      expect(await provider.delete('a/first.txt')).toBe(false);
      await expect(provider.get('a/first.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await provider.list()).map((meta) => meta.key)).toEqual(['a/nested/third.txt', 'b/second.txt']);
    });

    it('rejects keys that try to escape the store', async () => {
      const provider = await create();
      for (const key of ['../escape.txt', 'a/../../escape.txt', '/absolute.txt', 'a//double.txt', '.', 'a/./b', 'C:/windows', 'a\\b']) {
        await expect(provider.put(key, bytes('x'))).rejects.toMatchObject({ code: 'CONFLICT' });
      }
      expect(await provider.list()).toEqual([]);
    });

    it('survives a provider restart on the same root', async () => {
      const root = tempDir();
      const first = createFileBlobProvider({ root: path.join(root, 'blobs') });
      const meta = await first.put('backups/copy.bin', bytes('persist me'), { contentType: 'text/plain' });
      const second = createFileBlobProvider({ root: path.join(root, 'blobs') });
      expect(await second.get(meta.key)).toEqual(bytes('persist me'));
      expect(await second.list()).toEqual([expect.objectContaining({ key: meta.key, checksum: meta.checksum, contentType: 'text/plain' })]);
    });

    it('enforces an optional maxBytes ceiling', async () => {
      const root = tempDir();
      const provider = createFileBlobProvider({ root, maxBytes: 4 });
      expect(provider.capabilities.maxBytes).toBe(4);
      await expect(provider.put('too-big.bin', bytes('12345'))).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await provider.put('fits.bin', bytes('1234'))).size).toBe(4);
    });
  });
}

runBlobProviderContract('file', async () => createFileBlobProvider({ root: path.join(tempDir(), 'blobs') }));

describe('Y-07a: profile wiring', () => {
  it('publishes the blob collection in both profiles and serves bytes', async () => {
    const dataDir = tempDir();
    const fileProfile = createFileProfile({ blobsDir: path.join(dataDir, 'blobs') });
    profiles.push(fileProfile);
    expect(fileProfile.manifest.collections).toContain('blobs');
    expect(fileProfile.blobs?.kind).toBe('file');
    const meta = await fileProfile.blobs!.put('attachments/a.txt', bytes('hello'), { contentType: 'text/plain' });
    expect(await fileProfile.blobs!.size(meta.key)).toBe(5);

    const sqlite = createSqliteProfile({ databasePath: path.join(dataDir, 'db', 'storage.sqlite') });
    profiles.push(sqlite);
    expect(sqlite.manifest.collections).toContain('blobs');
    await sqlite.blobs!.put('exports/b.json', bytes('{}'));
    expect(await sqlite.blobs!.get('exports/b.json')).toEqual(bytes('{}'));
    expect((await sqlite.blobs!.list('exports/')).length).toBe(1);
  });
});
