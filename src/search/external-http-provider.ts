/**
 * Y-04b — OpenAI-совместимый HTTP-провайдер эмбеддингов.
 *
 * Используется только внутри обёртки Y-04a (`createExternalEmbeddingProvider`), поэтому сам не
 * включает и не выключает egress: флаг, ключи, лимиты и стоимость — слой политики. Здесь — сеть:
 * `POST {baseUrl}/embeddings`, таймауты, ретраи на 429/5xx/сетевые ошибки, разбиение на батчи и
 * строгая проверка формы ответа. Ошибка не превращается в пустую выдачу — она бросается, а обёртка
 * помечает деградацию.
 */

import {
  EmbeddingError,
  type EmbeddingFingerprint,
  type EmbeddingProvider,
} from './contracts.js';

export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Per-request timeout; defaults to 10s. */
  timeoutMs?: number;
  /** Retries on 429/5xx/network errors; defaults to 2. */
  maxRetries?: number;
  /** Texts per HTTP request; defaults to 64. */
  maxTextsPerRequest?: number;
  /** Backoff base; injected sleep makes tests instant. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_TEXTS_PER_REQUEST = 64;
const DEFAULT_RETRY_DELAY_MS = 200;

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createOpenAiCompatibleEmbeddingProvider(
  options: OpenAICompatibleOptions,
): EmbeddingProvider {
  if (!options.baseUrl) throw new EmbeddingError('INVALID_INPUT', 'external embeddings: baseUrl is required');
  if (!options.model) throw new EmbeddingError('INVALID_INPUT', 'external embeddings: model is required');

  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/embeddings`;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const maxTextsPerRequest = Math.max(1, options.maxTextsPerRequest ?? DEFAULT_MAX_TEXTS_PER_REQUEST);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fingerprint: EmbeddingFingerprint = {
    modelId: `openai-compatible:${options.model}`,
    dimension: 0,
    pooling: 'model',
    queryPrefix: '',
    docPrefix: '',
  };

  async function requestOnce(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ model: options.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status;
        const error = new Error(`external embeddings HTTP ${status}`);
        (error as Error & { status?: number; retryable?: boolean }).status = status;
        (error as Error & { retryable?: boolean }).retryable = isRetryableStatus(status);
        throw error;
      }
      const body = (await response.json()) as EmbeddingsResponse;
      if (!Array.isArray(body.data) || body.data.length !== texts.length) {
        throw new EmbeddingError(
          'INVALID_INPUT',
          `external embeddings returned ${body.data?.length ?? 0} vectors for ${texts.length} texts`,
        );
      }
      return body.data.map((entry, index) => {
        const embedding = entry?.embedding;
        if (!Array.isArray(embedding) || embedding.length === 0) {
          throw new EmbeddingError('INVALID_INPUT', `external embeddings returned no vector at index ${index}`);
        }
        if (!embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          throw new EmbeddingError('INVALID_INPUT', `external embeddings returned a non-finite vector at index ${index}`);
        }
        return embedding;
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const timeout = new Error(`external embeddings timed out after ${timeoutMs}ms`);
        (timeout as Error & { retryable?: boolean }).retryable = true;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestWithRetry(texts: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await requestOnce(texts);
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof Error &&
          ((error as Error & { retryable?: boolean }).retryable === true ||
            error.name === 'TypeError' || // fetch network failure
            error.name === 'FetchError');
        if (!retryable || attempt === maxRetries) break;
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function embedMany(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += maxTextsPerRequest) {
      const slice = texts.slice(start, start + maxTextsPerRequest);
      const embeddings = await requestWithRetry(slice);
      for (const embedding of embeddings) {
        if (fingerprint.dimension === 0) fingerprint.dimension = embedding.length;
        if (embedding.length !== fingerprint.dimension) {
          throw new EmbeddingError(
            'INVALID_INPUT',
            `external embeddings dimension changed: ${embedding.length} != ${fingerprint.dimension}`,
          );
        }
        vectors.push(Float32Array.from(embedding));
      }
    }
    return vectors;
  }

  return {
    fingerprint: () => ({ ...fingerprint }),
    isReady: () => true,
    async embedQuery(text: string): Promise<Float32Array> {
      const [vector] = await embedMany([text]);
      if (!vector) throw new EmbeddingError('INVALID_INPUT', 'external embeddings returned no vector for the query');
      return vector;
    },
    async embedDocuments(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      return embedMany(texts);
    },
  };
}
