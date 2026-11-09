/**
 * Y-04a — внешний провайдер эмбеддингов: флаг, ключи через SecretManager, лимиты и учёт стоимости.
 *
 * Провайдер — обёртка над «внутренним» провайдером (локальный или HTTP-адаптер Y-04b). Обёртка
 * отвечает за правила ADR-009: вызовы только при явном флаге, ключ достаётся из `SecretManager`
 * лениво и никогда не попадает в логи, лимит текстов в минуту, учёт стоимости и честный признак
 * деградации вместо «ничего не найдено».
 */

import type { EmbeddingProvider } from './contracts.js';
import {
  ExternalEmbeddingError,
  externalEmbeddingStartupWarning,
  type ExternalEmbeddingConfig,
  type ExternalEmbeddingGate,
} from './external-policy.js';

/** Minimal SecretManager surface; keeps the provider testable without a real secret backend. */
export interface SecretAccess {
  get(key: string): Promise<string | undefined>;
}

export interface ExternalUsageStats {
  requests: number;
  texts: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  /** Set when a rate limit was hit (ms epoch), 0 otherwise. */
  limitedAt: number;
}

export interface ExternalEmbeddingProvider extends EmbeddingProvider {
  stats(): ExternalUsageStats;
  /** Startup warning text (null when the feature is off); also emitted through `onEvent`. */
  lastWarning(): string | null;
}

export interface ExternalEmbeddingProviderOptions {
  config: ExternalEmbeddingConfig;
  policy: ExternalEmbeddingGate;
  inner: EmbeddingProvider;
  secrets?: SecretAccess;
  now?: () => number;
  /** Observability hook: warning/error text only — never the secret value. */
  onEvent?: (event: { type: 'warning' | 'error'; message: string }) => void;
}

const RATE_WINDOW_MS = 60_000;

export function createExternalEmbeddingProvider(options: ExternalEmbeddingProviderOptions): ExternalEmbeddingProvider {
  const { config, policy, inner } = options;
  const clock = options.now ?? (() => Date.now());
  const usage: ExternalUsageStats = {
    requests: 0,
    texts: 0,
    estimatedTokens: 0,
    estimatedCostUsd: 0,
    limitedAt: 0,
  };
  const recentTexts: number[] = [];
  let warning = externalEmbeddingStartupWarning(config);
  let secretValue: string | undefined;
  let secretFetched = false;
  let secretRequested = false;

  if (warning) options.onEvent?.({ type: 'warning', message: warning });

  async function ensureKey(): Promise<void> {
    if (!config.keyRef) return;
    if (secretFetched) return;
    if (secretRequested) return;
    secretRequested = true;
    if (!options.secrets) {
      throw new ExternalEmbeddingError(
        'MISSING_KEY',
        `external embeddings need SecretManager key ${config.keyRef}, but no secret backend is available`,
      );
    }
    secretValue = await options.secrets.get(config.keyRef);
    secretFetched = true;
    if (!secretValue) {
      throw new ExternalEmbeddingError('MISSING_KEY', `secret ${config.keyRef} is not configured`);
    }
    // The value itself is deliberately never logged: only the key name above.
  }

  function enforceRateLimit(texts: number): void {
    if (config.maxTextsPerMinute <= 0) return;
    const now = clock();
    while (recentTexts.length > 0 && recentTexts[0] <= now - RATE_WINDOW_MS) recentTexts.shift();
    if (recentTexts.length + texts > config.maxTextsPerMinute) {
      usage.limitedAt = now;
      const error = new ExternalEmbeddingError(
        'RATE_LIMITED',
        `external embeddings rate limit exceeded (${config.maxTextsPerMinute} texts/minute)`,
      );
      options.onEvent?.({ type: 'error', message: error.message });
      throw error;
    }
    for (let index = 0; index < texts; index += 1) recentTexts.push(now);
  }

  function accountRequest(texts: string[]): void {
    usage.requests += 1;
    usage.texts += texts.length;
    const estimatedTokens = texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
    usage.estimatedTokens += estimatedTokens;
    usage.estimatedCostUsd += (estimatedTokens / 1_000_000) * config.costPerMillionTokensUsd;
  }

  async function assertEnabled(): Promise<void> {
    if (!config.enabled) {
      throw new ExternalEmbeddingError(
        'DISABLED',
        'external embeddings are disabled (EMBEDDINGS_EXTERNAL_ENABLED is not set)',
      );
    }
    await ensureKey();
  }

  return {
    fingerprint: () => {
      const innerFingerprint = inner.fingerprint();
      return {
        ...innerFingerprint,
        modelId: `external:${config.provider}:${config.model ?? innerFingerprint.modelId}`,
      };
    },
    isReady: () => config.enabled && inner.isReady(),
    async embedQuery(text: string): Promise<Float32Array> {
      await assertEnabled();
      enforceRateLimit(1);
      try {
        const vector = await inner.embedQuery(text);
        accountRequest([text]);
        return vector;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.onEvent?.({ type: 'error', message: `external provider failed: ${message}` });
        throw new ExternalEmbeddingError('PROVIDER_ERROR', `external provider failed: ${message}`);
      }
    },
    async embedDocuments(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      await assertEnabled();
      enforceRateLimit(texts.length);
      try {
        const vectors = await inner.embedDocuments(texts);
        accountRequest(texts);
        return vectors;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.onEvent?.({ type: 'error', message: `external provider failed: ${message}` });
        throw new ExternalEmbeddingError('PROVIDER_ERROR', `external provider failed: ${message}`);
      }
    },
    stats: () => ({ ...usage }),
    lastWarning: () => warning,
  };
}
