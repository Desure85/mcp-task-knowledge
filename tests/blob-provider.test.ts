/**
 * Y-07a — общий контракт `BlobProvider` и файловая реализация.
 *
 * Набор вынесен в `runBlobProviderContract`, потому что Y-07b обязан прогнать через него
 * S3/MinIO-адаптер: один и тот же контракт, а не «похожие» тесты на каждый бэкенд.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileBlobProvider } from '../src/storage/blobs/file-blob-provider.js';
import {
  createS3BlobProvider,
  randomS3TestPrefix,
  s3BlobProviderConfigFromEnv,
} from '../src/storage/blobs/s3-blob-provider.js';
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

afterEach(async () => {
  for (const profile of profiles.splice(0)) profile.close?.();
  for (const close of servers.splice(0)) await close();
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

const servers: Array<() => Promise<void>> = [];

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

/** Minimal S3-compatible fake used to exercise the wire protocol without Docker/network. */
async function createFakeS3(): Promise<{
  provider: BlobProvider;
  close: () => Promise<void>;
  requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }>;
  buckets: Set<string>;
}> {
  const buckets = new Set<string>();
  const objects = new Map<string, { data: Uint8Array; contentType?: string }>();
  const requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders }> = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const segments = url.pathname.split('/').filter(Boolean);
    const respond = (status: number, body: string | Uint8Array = '', headers: Record<string, string> = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (segments.length >= 1 && req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const bucket = segments[0];
      if (!buckets.has(bucket)) return respond(404, 'NoSuchBucket');
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = [...objects.keys()]
        .filter((entry) => entry.startsWith(bucket + '/'))
        .map((entry) => entry.slice(bucket.length + 1))
        .filter((entry) => entry.startsWith(prefix))
        .sort();
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>',
        ...keys.map(
          (entry) =>
            '<Contents><Key>' +
            entry.replace(/&/g, '&amp;') +
            '</Key><Size>' +
            objects.get(bucket + '/' + entry)!.data.byteLength +
            '</Size><LastModified>2026-11-10T00:00:00.000Z</LastModified></Contents>',
        ),
        '</ListBucketResult>',
      ].join('');
      return respond(200, body, { 'content-type': 'application/xml' });
    }
    if (segments.length === 1) {
      if (req.method === 'HEAD') return respond(buckets.has(segments[0]) ? 200 : 404, '', {});
      if (req.method === 'PUT') {
        buckets.add(segments[0]);
        return respond(200, '', {});
      }
    }
    if (segments.length >= 2) {
      const bucket = segments[0];
      const key = segments.slice(1).join('/');
      if (!buckets.has(bucket)) return respond(404, 'NoSuchBucket');
      const stored = objects.get(bucket + '/' + key);
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const data = new Uint8Array(Buffer.concat(chunks));
          objects.set(bucket + '/' + key, {
            data,
            contentType: typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined,
          });
          respond(200, '', { etag: 'fake' });
        });
        return;
      }
      if (!stored) return respond(404, 'NoSuchKey');
      if (req.method === 'GET') return respond(200, Buffer.from(stored.data), { 'content-type': stored.contentType ?? 'application/octet-stream' });
      if (req.method === 'HEAD') {
        return respond(200, '', {
          'content-length': String(stored.data.byteLength),
          'content-type': stored.contentType ?? 'application/octet-stream',
          'x-amz-meta-sha256': 'sha256:' + createHash('sha256').update(Buffer.from(stored.data)).digest('hex'),
          etag: 'fake',
        });
      }
      if (req.method === 'DELETE') {
        objects.delete(bucket + '/' + key);
        return respond(204, '', {});
      }
    }
    return respond(400, 'unsupported');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake s3 failed to bind');
  const endpoint = 'http://127.0.0.1:' + address.port;
  const provider = createS3BlobProvider({
    endpoint,
    bucket: 'logs',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    region: 'us-east-1',
    pathStyle: true,
  });
  return {
    provider,
    requests,
    buckets,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('Y-07b: S3 adapter wire protocol', () => {
  it('signs requests with SigV4 fields and keeps metadata/checksums', async () => {
    const fake = await createFakeS3();
    try {
      const meta = await fake.provider.put('attachments/a.txt', bytes('hello s3'), {
        contentType: 'text/plain',
      });
      const putRequest = fake.requests.find((request) => request.method === 'PUT' && request.url.includes('/attachments/a.txt'));
      expect(putRequest, JSON.stringify(fake.requests)).toBeDefined();
      const authorization = String(putRequest!.headers.authorization);
      expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request/);
      expect(authorization).toContain('SignedHeaders=');
      expect(authorization).toContain('x-amz-content-sha256');
      expect(authorization).toContain('x-amz-meta-sha256');
      expect(putRequest!.headers['x-amz-content-sha256']).toBe(sha256NonPrefixed(bytes('hello s3')));
      expect(putRequest!.headers['x-amz-meta-sha256']).toBe(meta.checksum);

      expect(await fake.provider.get('attachments/a.txt')).toEqual(bytes('hello s3'));
      expect(await fake.provider.size('attachments/a.txt')).toBe(bytes('hello s3').byteLength);
      await expect(fake.provider.get('missing/x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await fake.provider.delete('missing/x')).toBe(false);
      expect(await fake.provider.delete('attachments/a.txt')).toBe(true);
      expect(await fake.provider.list()).toEqual([]);
      expect(fake.buckets.has('logs')).toBe(true);
    } finally {
      await fake.close();
    }
  });
});

function sha256NonPrefixed(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

runBlobProviderContract('s3 (fake server)', async () => {
  const fake = await createFakeS3();
  servers.push(fake.close);
  return fake.provider;
});

const s3Env = s3BlobProviderConfigFromEnv();
const s3MinioConfigured = s3Env !== undefined;

if (s3MinioConfigured) {
  runBlobProviderContract('s3 (MinIO from BLOB_S3_*)', async () => {
    const prefix = randomS3TestPrefix();
    return createS3BlobProvider({ ...s3Env!, prefix });
  });
} else {
  describe.skip('s3 (MinIO from BLOB_S3_*) — documented skip', () => {
    it('runs the same contract against MinIO when BLOB_S3_* is set (CI bulk-smoke provides it)', () => {
      // Local environments without Docker/network skip this; the fake-server run above and the
      // CI MinIO service cover the same contract suite.
    });
  });
}

describe('Y-07b: key prefix isolation', () => {
  it('prefix is part of every object URL inside the shared bucket', async () => {
    const urls: string[] = [];
    const server = http.createServer((req, res) => {
      urls.push(req.url ?? '/');
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<ListBucketResult></ListBucketResult>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('bind failed');
    try {
      const prod = createS3BlobProvider({
        endpoint: 'http://127.0.0.1:' + address.port,
        bucket: 'b',
        prefix: 'team-a',
        accessKeyId: 'k',
        secretAccessKey: 's',
        createBucket: false,
      });
      await expect(prod.put('../../escape.txt', bytes('x'))).rejects.toMatchObject({ code: 'CONFLICT' });
      const other = createS3BlobProvider({
        endpoint: 'http://127.0.0.1:' + address.port,
        bucket: 'b',
        prefix: 'team-b',
        accessKeyId: 'k',
        secretAccessKey: 's',
        createBucket: false,
      });
      expect(other.capabilities.presign).toBe(false);
      await prod.put('attachments/a.txt', bytes('x'));
      expect(urls.some((url) => url.startsWith('/b/team-a/attachments/a.txt'))).toBe(true);
      expect(urls.some((url) => url.startsWith('/b/team-b/'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('Y-07b: env configuration', () => {
  it('returns undefined unless the minimal BLOB_S3_* set is complete', () => {
    expect(s3BlobProviderConfigFromEnv({})).toBeUndefined();
    expect(s3BlobProviderConfigFromEnv({ BLOB_S3_ENDPOINT: 'http://x', BLOB_S3_BUCKET: 'b' })).toBeUndefined();
    expect(
      s3BlobProviderConfigFromEnv({
        BLOB_S3_ENDPOINT: 'http://x',
        BLOB_S3_BUCKET: 'b',
        BLOB_S3_ACCESS_KEY: 'a',
        BLOB_S3_SECRET_KEY: 's',
      }),
    ).toEqual({ endpoint: 'http://x', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', region: 'us-east-1' });
  });
});
