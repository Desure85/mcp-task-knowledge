/**
 * Y-07b — S3/MinIO `BlobProvider` (SigV4, без новой зависимости).
 *
 * Тот же контракт, что и файловый провайдер (`tests/blob-provider.test.ts` прогоняет один набор через
 * оба бэкенда). Подпись AWS Signature Version 4 реализована локально: canonical request → string to
 * sign → signing key → `Authorization`, с `x-amz-content-sha256` и `x-amz-meta-sha256`, поэтому
 * содержимое проверяемо по контрольной сумме и после перезапуска процесса.
 *
 * Используется для вложений, экспортов и копий — не как основное хранилище задач/документов.
 * `presign` осознанно `false`: presigned URL не реализованы, и врать в capabilities нельзя.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { StoreError, type BlobMetadata, type BlobProvider, type BlobPutOptions } from '../contracts.js';
import { assertValidBlobKey } from './file-blob-provider.js';

export interface S3BlobProviderOptions {
  /** Origin S3-совместимого сервиса, e.g. `http://127.0.0.1:9000`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Key prefix inside the bucket (useful to isolate test runs). */
  prefix?: string;
  /** Path-style addressing is required by MinIO; virtual-host style is optional otherwise. */
  pathStyle?: boolean;
  /** Create the bucket on first use (MinIO allows it with root credentials). */
  createBucket?: boolean;
  maxBytes?: number;
  /** Test hook: fixed clock so signatures are reproducible. */
  now?: () => Date;
  /** Test hook: transport override (the default is global fetch). */
  fetchImpl?: typeof fetch;
}

export interface AwsSigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface AwsSigV4Input {
  method: string;
  url: URL;
  /** Headers that will be sent; `host` is derived from the URL when absent. */
  headers: Record<string, string>;
  payloadHash: string;
  credentials: AwsSigV4Credentials;
  now?: Date;
}

export interface AwsSigV4Result {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  authorization: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function isoDay(amz: string): string {
  return amz.slice(0, 8);
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(url: URL): string {
  const segments = url.pathname.split('/').map((segment) => encodePathSegment(segment));
  return segments.join('/') || '/';
}

function canonicalQuery(url: URL): string {
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => entries.push([key, value]));
  entries.sort(([aKey, aValue], [bKey, bValue]) => (aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)));
  return entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}=${encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    )
    .join('&');
}

/**
 * AWS Signature Version 4 for a single request. Exported so the test can pin the published
 * `get-vanilla` test vector instead of trusting this implementation to verify itself.
 */
export function signAwsRequest(input: AwsSigV4Input): AwsSigV4Result {
  const service = input.credentials.service ?? 's3';
  const day = isoDay(amzDate(input.now ?? new Date()));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) headers[key.toLowerCase()] = value;
  if (!headers.host) headers.host = input.url.host;
  headers['x-amz-date'] = amzDate(input.now ?? new Date());
  headers['x-amz-content-sha256'] = input.payloadHash;
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const credentialScope = `${day}/${input.credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    headers['x-amz-date'],
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${input.credentials.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, input.credentials.region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, authorization }, canonicalRequest, stringToSign, signature, authorization };
}

export interface S3BlobProviderEnv {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

/** Reads `BLOB_S3_*`; returns undefined unless the full minimal configuration is present. */
export function s3BlobProviderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3BlobProviderEnv | undefined {
  const endpoint = env.BLOB_S3_ENDPOINT?.trim();
  const bucket = env.BLOB_S3_BUCKET?.trim();
  const accessKeyId = env.BLOB_S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.BLOB_S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: env.BLOB_S3_REGION?.trim() || 'us-east-1' };
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function createS3BlobProvider(options: S3BlobProviderOptions): BlobProvider {
  const endpoint = new URL(options.endpoint.replace(/\/$/, ''));
  const region = options.region ?? 'us-east-1';
  const prefix = (options.prefix ?? '').replace(/^\/+|\/+$/g, '');
  const pathStyle = options.pathStyle ?? true;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.now ?? (() => new Date());
  let bucketReady: Promise<void> | undefined;

  function joinKey(key: string): string {
    return prefix ? (key ? `${prefix}/${key}` : prefix) : key;
  }

  function objectKey(key: string): string {
    // One key grammar for every backend: an S3 adapter must not accept what the file provider rejects.
    assertValidBlobKey(key);
    return joinKey(key);
  }

  function urlFor(key?: string, query?: Record<string, string>): URL {
    const url = new URL(endpoint.toString());
    url.pathname = '';
    if (pathStyle) {
      url.pathname = `/${options.bucket}${key === undefined ? '' : `/${key.split('/').map(encodePathSegment).join('/')}`}`;
    } else {
      url.host = `${options.bucket}.${url.host}`;
      url.pathname = key === undefined ? '/' : `/${key.split('/').map(encodePathSegment).join('/')}`;
    }
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return url;
  }

  function credentials() {
    return {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region,
      service: 's3',
    };
  }

  async function send(
    method: string,
    url: URL,
    body: Uint8Array | undefined,
    extraHeaders: Record<string, string> = {},
    payloadHash?: string,
  ): Promise<Response> {
    const hash = payloadHash ?? sha256Hex(body ?? new Uint8Array());
    const signed = signAwsRequest({
      method,
      url,
      headers: { ...extraHeaders },
      payloadHash: hash,
      credentials: credentials(),
      now: clock(),
    });
    const headers: Record<string, string> = { ...extraHeaders, ...signed.headers };
    if (body) headers['content-length'] = String(body.byteLength);
    if (!('content-type' in headers) && body) headers['content-type'] = 'application/octet-stream';
    return fetchImpl(url, { method, headers, body: body ? (body as unknown as BodyInit) : undefined });
  }

  async function ensureBucket(): Promise<void> {
    if (options.createBucket === false) return;
    if (!bucketReady) {
      bucketReady = (async () => {
        const head = await send('HEAD', urlFor(), undefined);
        if (head.status === 404) {
          const created = await send('PUT', urlFor(), new Uint8Array());
          if (!created.ok) {
            throw new StoreError('CONFLICT', `failed to create bucket ${options.bucket}`, { status: created.status });
          }
        } else if (!head.ok && head.status !== 403) {
          throw new StoreError('CONFLICT', `failed to probe bucket ${options.bucket}`, { status: head.status });
        }
      })().catch((error) => {
        bucketReady = undefined;
        throw error;
      });
    }
    return bucketReady;
  }

  function failure(operation: string, key: string | undefined, response: Response, bodyText: string): never {
    throw new StoreError('CONFLICT', `s3 ${operation} failed (${response.status}): ${bodyText.slice(0, 200)}`, {
      key,
      status: response.status,
    });
  }

  async function headObject(key: string): Promise<Response> {
    const response = await send('HEAD', urlFor(objectKey(key)), undefined);
    if (response.status === 404) throw new StoreError('NOT_FOUND', `blob not found: ${key}`, { key });
    if (!response.ok) failure('HEAD', key, response, await response.text().catch(() => ''));
    return response;
  }

  return {
    kind: 's3',
    capabilities: { presign: false, ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }) },
    async put(key: string, data: Uint8Array, putOptions?: BlobPutOptions): Promise<BlobMetadata> {
      if (options.maxBytes !== undefined && data.byteLength > options.maxBytes) {
        throw new StoreError('CONFLICT', `blob exceeds maxBytes=${options.maxBytes}`, { key, size: data.byteLength });
      }
      const target = objectKey(key);
      const checksum = `sha256:${sha256Hex(data)}`;
      const payloadHash = sha256Hex(data);
      await ensureBucket();
      const response = await send(
        'PUT',
        urlFor(target),
        data,
        {
          'x-amz-meta-sha256': checksum,
          ...(putOptions?.contentType === undefined ? {} : { 'content-type': putOptions.contentType }),
        },
        payloadHash,
      );
      if (!response.ok) failure('PUT', key, response, await response.text().catch(() => ''));
      return {
        key,
        size: data.byteLength,
        checksum,
        ...(putOptions?.contentType === undefined ? {} : { contentType: putOptions.contentType }),
        updatedAt: clock().toISOString(),
      };
    },
    async get(key: string): Promise<Uint8Array> {
      const response = await send('GET', urlFor(objectKey(key)), undefined);
      if (response.status === 404) throw new StoreError('NOT_FOUND', `blob not found: ${key}`, { key });
      if (!response.ok) failure('GET', key, response, await response.text().catch(() => ''));
      return new Uint8Array(await response.arrayBuffer());
    },
    async size(key: string): Promise<number> {
      const response = await headObject(key);
      const length = response.headers.get('content-length');
      if (length === null) throw new StoreError('CONFLICT', `s3 HEAD for ${key} returned no content-length`, { key });
      return Number(length);
    },
    async delete(key: string): Promise<boolean> {
      const response = await send('DELETE', urlFor(objectKey(key)), undefined);
      if (response.status === 404) return false;
      if (!response.ok && response.status !== 204) failure('DELETE', key, response, await response.text().catch(() => ''));
      return true;
    },
    async list(keyPrefix?: string): Promise<BlobMetadata[]> {
      await ensureBucket();
      const query: Record<string, string> = { 'list-type': '2' };
      const scoped = joinKey(keyPrefix ?? '');
      if (scoped) query.prefix = scoped;
      const response = await send('GET', urlFor(undefined, query), undefined);
      if (!response.ok) failure('LIST', undefined, response, await response.text().catch(() => ''));
      const xml = await response.text();
      const entries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
        const block = match[1];
        const key = xmlDecode(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? '');
        return { key, size: Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] ?? '0') };
      });
      const logs: BlobMetadata[] = [];
      for (const entry of entries) {
        const visible = prefix ? entry.key.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?`), '') : entry.key;
        if (!visible) continue;
        try {
          const head = await headObject(visible);
          const checksum = head.headers.get('x-amz-meta-sha256') ?? `etag:${head.headers.get('etag') ?? ''}`;
          const contentType = head.headers.get('content-type') ?? undefined;
          const lastModified = head.headers.get('last-modified');
          logs.push({
            key: visible,
            size: Number(head.headers.get('content-length') ?? entry.size),
            checksum,
            ...(contentType === undefined ? {} : { contentType }),
            updatedAt: lastModified ? new Date(lastModified).toISOString() : clock().toISOString(),
          });
        } catch (error) {
          if ((error as StoreError).code === 'NOT_FOUND') continue;
          throw error;
        }
      }
      return logs
        .filter((meta) => !keyPrefix || meta.key.startsWith(keyPrefix))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
  };
}

/** Unique prefix for a test/manual run: never collide with existing objects. */
export function randomS3TestPrefix(): string {
  return `test-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}
