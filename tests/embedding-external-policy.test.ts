/**
 * Y-04a — политика внешних провайдеров эмбеддингов.
 *
 * Сеть в тестах не используется: «внутренний» провайдер — fake, ключи — fake-SecretManager. Проверяем
 * ровно правила ADR-009: без флага внешних вызовов нет; ключ достаётся лениво и не попадает в логи;
 * лимиты работают; приватные проекты и trustLevel=external не уходят наружу; статус честно говорит,
 * включён ли egress.
 */

import { describe, it, expect } from 'vitest';
import {
  EmbeddingError,
  type EmbeddingProvider,
} from '../src/search/contracts.js';
import {
  ExternalEmbeddingError,
  createExternalEmbeddingGate,
  externalEmbeddingPrivacyEntry,
  externalEmbeddingStartupWarning,
  readExternalEmbeddingConfig,
  type ExternalEmbeddingConfig,
} from '../src/search/external-policy.js';
import { createExternalEmbeddingProvider } from '../src/search/external-provider.js';
import { createFileIndexingService, type IndexingItem } from '../src/search/indexing-service.js';
import { createFileChunkingStrategy } from '../src/search/embeddings-file.js';
import { buildEmbeddingsStatus } from '../src/search/embeddings-status.js';

const SECRET_VALUE = 'secret-token-value-that-must-not-leak';

function fakeConfig(overrides: Partial<ExternalEmbeddingConfig> = {}): ExternalEmbeddingConfig {
  return {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://embeddings.example.test/v1',
    model: 'text-embedding-3-small',
    keyRef: 'EMBEDDINGS_EXTERNAL_API_KEY',
    maxTextsPerMinute: 0,
    costPerMillionTokensUsd: 0.02,
    excludedProjects: ['private-project'],
    excludedTrustLevels: ['external'],
    ...overrides,
  };
}

function fakeInner() {
  const calls: string[][] = [];
  const provider: EmbeddingProvider = {
    fingerprint: () => ({ modelId: 'inner-model', dimension: 3, pooling: 'mean', queryPrefix: '', docPrefix: '' }),
    isReady: () => true,
    async embedQuery(text: string) {
      calls.push([text]);
      return Float32Array.from([text.length, 0, 0]);
    },
    async embedDocuments(texts: string[]) {
      calls.push([...texts]);
      return texts.map((text) => Float32Array.from([text.length, 0, 0]));
    },
  };
  return { provider, calls };
}

function fakeSecrets(value: string | null = SECRET_VALUE) {
  const requests: string[] = [];
  return {
    requests,
    secretManager: {
      async get(key: string) {
        requests.push(key);
        return value ?? undefined;
      },
    },
  };
}

function trustLevelItem(id: string, trustLevel?: IndexingItem['trustLevel'], project = 'p'): IndexingItem {
  return { store: 'knowledge', kind: 'doc', project, id, text: `text ${id}`, trustLevel };
}

describe('Y-04a: disabled by default', () => {
  it('is off unless the flag is set', () => {
    const config = readExternalEmbeddingConfig({});
    expect(config.enabled).toBe(false);
    expect(externalEmbeddingStartupWarning(config)).toBeNull();
  });

  it('makes no external calls when disabled', async () => {
    const inner = fakeInner();
    const secrets = fakeSecrets();
    const config = readExternalEmbeddingConfig({});
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      inner: inner.provider,
      secrets: secrets.secretManager,
    });

    expect(provider.isReady()).toBe(false);
    await expect(provider.embedQuery('hello')).rejects.toBeInstanceOf(ExternalEmbeddingError);
    await expect(provider.embedDocuments(['a'])).rejects.toMatchObject({ code: 'DISABLED' });
    expect(inner.calls).toHaveLength(0);
    expect(secrets.requests).toHaveLength(0);
    expect(provider.stats()).toMatchObject({ requests: 0, texts: 0 });
  });
});

describe('Y-04a: enabled provider', () => {
  it('resolves the key lazily, never logs it, and accounts usage/cost', async () => {
    const inner = fakeInner();
    const secrets = fakeSecrets();
    const events: Array<{ type: string; message: string }> = [];
    const config = fakeConfig();
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      inner: inner.provider,
      secrets: secrets.secretManager,
      onEvent: (event) => events.push(event),
    });

    expect(provider.lastWarning()).toMatch(/external embeddings are ENABLED/);
    expect(secrets.requests).toHaveLength(0);

    const vectors = await provider.embedDocuments(['abcd', 'abcdefgh']);
    expect(vectors).toHaveLength(2);
    expect(inner.calls).toEqual([['abcd', 'abcdefgh']]);
    expect(secrets.requests).toEqual(['EMBEDDINGS_EXTERNAL_API_KEY']);
    expect(provider.stats()).toMatchObject({ requests: 1, texts: 2 });
    // ceil(4/4) + ceil(8/4) = 3 estimated tokens -> 3/1e6 * 0.02
    expect(provider.stats().estimatedCostUsd).toBeCloseTo((3 / 1_000_000) * 0.02, 10);
    expect(JSON.stringify(events)).not.toContain(SECRET_VALUE);
    expect(provider.fingerprint().modelId).toBe('external:openai-compatible:text-embedding-3-small');
  });

  it('turns provider failures into a degradation marker without leaking the secret', async () => {
    const failingInner: EmbeddingProvider = {
      fingerprint: () => ({ modelId: 'inner', dimension: 3, pooling: 'mean', queryPrefix: '', docPrefix: '' }),
      isReady: () => true,
      async embedQuery() {
        throw new Error('boom');
      },
      async embedDocuments() {
        throw new Error('boom');
      },
    };
    const events: Array<{ type: string; message: string }> = [];
    const config = fakeConfig();
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      inner: failingInner,
      secrets: fakeSecrets().secretManager,
      onEvent: (event) => events.push(event),
    });

    await expect(provider.embedDocuments(['a'])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(events.some((event) => event.type === 'error')).toBe(true);
    // The failure marker must not smuggle the resolved secret into logs.
    expect(JSON.stringify(events)).not.toContain(SECRET_VALUE);
  });

  it('fails honestly when the secret is missing', async () => {
    const inner = fakeInner();
    const secrets = fakeSecrets(null);
    const config = fakeConfig();
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      inner: inner.provider,
      secrets: secrets.secretManager,
    });
    await expect(provider.embedDocuments(['a'])).rejects.toMatchObject({ code: 'MISSING_KEY' });
    expect(inner.calls).toHaveLength(0);
  });

  it('enforces the texts-per-minute limit and recovers after the window', async () => {
    let clock = 1_000;
    const inner = fakeInner();
    const config = fakeConfig({ maxTextsPerMinute: 2 });
    const provider = createExternalEmbeddingProvider({
      config,
      policy: createExternalEmbeddingGate(config),
      inner: inner.provider,
      secrets: fakeSecrets().secretManager,
      now: () => clock,
    });

    await provider.embedDocuments(['a', 'b']);
    await expect(provider.embedDocuments(['c'])).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(provider.stats().limitedAt).toBe(clock);

    clock += 61_000;
    await expect(provider.embedDocuments(['c', 'd'])).resolves.toHaveLength(2);
  });
});

describe('Y-04a: policy gate', () => {
  it('keeps private projects and trustLevel=external docs local', () => {
    const gate = createExternalEmbeddingGate(fakeConfig());
    expect(gate.decide({ project: 'p' })).toEqual({ allowed: true });
    expect(gate.decide({ project: 'private-project' }).allowed).toBe(false);
    expect(gate.decide({ project: 'p', trustLevel: 'external' }).allowed).toBe(false);
    expect(gate.decide({ project: 'p', trustLevel: 'user' }).allowed).toBe(true);
    expect(() => gate.assertAllowed({ project: 'private-project' })).toThrow(ExternalEmbeddingError);
  });

  it('denies everything when the flag is off', () => {
    const gate = createExternalEmbeddingGate(readExternalEmbeddingConfig({}));
    expect(gate.decide({ project: 'p' }).allowed).toBe(false);
  });

  it('reports the egress entry for the privacy declaration without the secret', () => {
    const entry = externalEmbeddingPrivacyEntry(fakeConfig());
    expect(entry.destination).toBe('https://embeddings.example.test/v1');
    expect(entry.dataSent).toContain('trustLevel=external');
    expect(JSON.stringify(entry)).not.toContain(SECRET_VALUE);
  });
});

describe('Y-04a: indexing honours the external policy', () => {
  it('never queues blocked items and reports them in status', async () => {
    const inner = fakeInner();
    const config = fakeConfig();
    const gate = createExternalEmbeddingGate(config);
    const items = [
      trustLevelItem('doc-1'),
      trustLevelItem('doc-2', 'external'),
      trustLevelItem('doc-3', undefined, 'private-project'),
    ];
    const service = createFileIndexingService({
      store: {
        async upsert() {},
        async delete() {},
        async query() {
          return [];
        },
        async stats() {
          return { collections: {}, total: 0 };
        },
        async clear() {},
      },
      chunker: createFileChunkingStrategy(),
      provider: async () => inner.provider,
      collect: async () => items,
      externalPolicy: (item) => gate.decide({ project: item.project, trustLevel: item.trustLevel }),
    });

    const result = await service.ensureIndexed('p');
    expect(result.queued).toBe(1);
    await service.drain();
    expect(inner.calls.flat()).toEqual(['text doc-1']);
    expect(service.status('p')[0]).toMatchObject({ blocked: 2, done: 1 });
  });

  it('embeddings_status reports egress state (disabled by default)', () => {
    const config = readExternalEmbeddingConfig({});
    const payload = buildEmbeddingsStatus({
      config: { embeddings: { mode: 'none' } },
      adapterInitAttempted: false,
      adapterReady: false,
      warmup: [],
      collections: [],
      indexing: [],
      external: {
        enabled: config.enabled,
        provider: config.provider,
        warning: externalEmbeddingStartupWarning(config),
      },
    }) as { external: { enabled: boolean; warning: string | null } };
    expect(payload.external).toEqual({ enabled: false, provider: 'openai-compatible', warning: null });
  });

  it('keeps EmbeddingError and ExternalEmbeddingError distinct', () => {
    expect(new EmbeddingError('CAPABILITY_UNAVAILABLE', 'x')).not.toBeInstanceOf(ExternalEmbeddingError);
  });
});
