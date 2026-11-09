/**
 * Y-04b — OpenAI-совместимый HTTP-провайдер эмбеддингов.
 *
 * Сеть только локальная: тест поднимает `node:http` на 127.0.0.1:0 и проверяет таймауты, ретраи,
 * батчи, авторизацию и форму ответа. Обёртка Y-04a проверяется вместе с HTTP-провайдером: без флага
 * запросов нет, при ошибке — признак деградации, а не пустая выдача.
 */

import { afterEach, describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOpenAiCompatibleEmbeddingProvider } from '../src/search/external-http-provider.js';
import { createExternalEmbeddingProvider } from '../src/search/external-provider.js';
import {
  createExternalEmbeddingGate,
  externalEmbeddingConfigProblem,
  type ExternalEmbeddingConfig,
} from '../src/search/external-policy.js';

interface RecordedRequest {
  authorization?: string;
  body?: { model?: string; input?: string[] };
}

interface TestServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const servers: TestServer[] = [];

async function startServer(
  handler: (request: RecordedRequest, response: http.ServerResponse) => void | Promise<void>,
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const recorded: RecordedRequest = {
      authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      body: raw ? (JSON.parse(raw) as { model?: string; input?: string[] }) : undefined,
    };
    requests.push(recorded);
    await handler(recorded, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const testServer: TestServer = {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
  servers.push(testServer);
  return testServer;
}

function respondEmbeddings(response: http.ServerResponse, texts: string[], dimension = 3): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      data: texts.map((text) => ({ embedding: Array.from({ length: dimension }, (_, index) => text.length + index) })),
    }),
  );
}

function enabledConfig(overrides: Partial<ExternalEmbeddingConfig> = {}): ExternalEmbeddingConfig {
  return {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1/v1',
    model: 'text-embedding-test',
    keyRef: 'TEST_KEY',
    maxTextsPerMinute: 0,
    costPerMillionTokensUsd: 0.5,
    excludedProjects: [],
    excludedTrustLevels: ['external'],
    ...overrides,
  };
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()!.close();
  }
});

describe('Y-04b: OpenAI-compatible HTTP provider', () => {
  it('posts texts with bearer auth and parses vectors', async () => {
    const server = await startServer((request, response) => {
      respondEmbeddings(response, request.body?.input ?? []);
    });
    const provider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${server.url}/v1`,
      model: 'text-embedding-test',
      apiKey: 'test-key',
    });

    const vectors = await provider.embedDocuments(['abcd', 'xy']);
    expect(vectors).toHaveLength(2);
    expect(Array.from(vectors[0])).toEqual([4, 5, 6]);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].authorization).toBe('Bearer test-key');
    expect(server.requests[0].body).toEqual({ model: 'text-embedding-test', input: ['abcd', 'xy'] });
    expect(provider.fingerprint()).toMatchObject({ modelId: 'openai-compatible:text-embedding-test', dimension: 3 });
  });

  it('splits batches by maxTextsPerRequest', async () => {
    const server = await startServer((request, response) => {
      respondEmbeddings(response, request.body?.input ?? []);
    });
    const provider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${server.url}/v1`,
      model: 'm',
      apiKey: 'k',
      maxTextsPerRequest: 2,
    });
    const vectors = await provider.embedDocuments(['a', 'bb', 'ccc']);
    expect(vectors).toHaveLength(3);
    expect(server.requests.map((request) => request.body?.input)).toEqual([['a', 'bb'], ['ccc']]);
  });

  it('retries a 500 and succeeds on the next attempt', async () => {
    let attempts = 0;
    const server = await startServer((request, response) => {
      attempts += 1;
      if (attempts === 1) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":"boom"}');
        return;
      }
      respondEmbeddings(response, request.body?.input ?? []);
    });
    const provider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${server.url}/v1`,
      model: 'm',
      apiKey: 'k',
      retryDelayMs: 0,
      sleep: async () => {},
    });
    const vectors = await provider.embedDocuments(['a']);
    expect(vectors).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('times out instead of hanging', async () => {
    const server = await startServer((request, response) => {
      setTimeout(() => respondEmbeddings(response, request.body?.input ?? []), 200);
    });
    const provider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${server.url}/v1`,
      model: 'm',
      apiKey: 'k',
      timeoutMs: 30,
      maxRetries: 0,
    });
    await expect(provider.embedQuery('slow')).rejects.toThrow(/timed out|abort/i);
  });

  it('rejects malformed responses and dimension changes', async () => {
    const badCount = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
    });
    const provider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${badCount.url}/v1`,
      model: 'm',
      apiKey: 'k',
      maxRetries: 0,
    });
    await expect(provider.embedDocuments(['a'])).rejects.toThrow(/returned 0 vectors/);

    let calls = 0;
    const varying = await startServer((request, response) => {
      calls += 1;
      respondEmbeddings(response, request.body?.input ?? [], calls === 1 ? 3 : 2);
    });
    const varyingProvider = createOpenAiCompatibleEmbeddingProvider({
      baseUrl: `${varying.url}/v1`,
      model: 'm',
      apiKey: 'k',
      maxTextsPerRequest: 1,
      retryDelayMs: 0,
      sleep: async () => {},
    });
    await expect(varyingProvider.embedDocuments(['a', 'b'])).rejects.toThrow(/dimension changed/);
  });

  it('validates an enabled configuration before creating a provider', () => {
    expect(externalEmbeddingConfigProblem(enabledConfig())).toBeNull();
    expect(externalEmbeddingConfigProblem(enabledConfig({ baseUrl: undefined }))).toMatch(/BASE_URL/);
    expect(externalEmbeddingConfigProblem(enabledConfig({ model: undefined }))).toMatch(/MODEL/);
    expect(externalEmbeddingConfigProblem(enabledConfig({ enabled: false }))).toBeNull();
  });
});

describe('Y-04b: policy wrapper around the HTTP provider', () => {
  it('makes no HTTP request when the flag is off', async () => {
    const server = await startServer((request, response) => {
      respondEmbeddings(response, request.body?.input ?? []);
    });
    const config = enabledConfig({ enabled: false, baseUrl: `${server.url}/v1` });
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      secrets: { async get() { return 'unused'; } },
      createInner: (secret) =>
        createOpenAiCompatibleEmbeddingProvider({
          baseUrl: config.baseUrl!,
          model: config.model!,
          apiKey: secret ?? '',
        }),
    });

    await expect(provider.embedDocuments(['a'])).rejects.toMatchObject({ code: 'DISABLED' });
    expect(server.requests).toHaveLength(0);
  });

  it('resolves the secret, sends it, accounts cost and marks degradation on failure', async () => {
    const server = await startServer((request, response) => {
      respondEmbeddings(response, request.body?.input ?? []);
    });
    const config = enabledConfig({ baseUrl: `${server.url}/v1`, costPerMillionTokensUsd: 1 });
    const events: Array<{ type: string; message: string }> = [];
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      secrets: { async get() { return 'http-secret'; } },
      createInner: (secret) =>
        createOpenAiCompatibleEmbeddingProvider({
          baseUrl: config.baseUrl!,
          model: config.model!,
          apiKey: secret ?? '',
        }),
      onEvent: (event) => events.push(event),
    });

    const vectors = await provider.embedDocuments(['abcd']);
    expect(vectors).toHaveLength(1);
    expect(server.requests[0].authorization).toBe('Bearer http-secret');
    expect(provider.stats()).toMatchObject({ requests: 1, texts: 1 });
    expect(provider.stats().estimatedCostUsd).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain('http-secret');
    expect(provider.fingerprint().modelId).toBe('external:openai-compatible:text-embedding-test');
  });

  it('reports PROVIDER_ERROR instead of an empty result when the server keeps failing', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"error":"unavailable"}');
    });
    const config = enabledConfig({ baseUrl: `${server.url}/v1` });
    const events: Array<{ type: string; message: string }> = [];
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      secrets: { async get() { return 'http-secret'; } },
      createInner: (secret) =>
        createOpenAiCompatibleEmbeddingProvider({
          baseUrl: config.baseUrl!,
          model: config.model!,
          apiKey: secret ?? '',
          maxRetries: 0,
        }),
      onEvent: (event) => events.push(event),
    });

    await expect(provider.embedDocuments(['a'])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(server.requests.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });
});
