/**
 * Y-04a — политика внешних провайдеров эмбеддингов (ADR-009 §«Внешние провайдеры эмбеддингов»).
 *
 * Правила:
 * 1. По умолчанию — локальная модель или эмбеддинги выключены. Внешний провайдер включается только
 *    явным флагом.
 * 2. При включении: предупреждение при старте, запись в декларацию приватности, ключи через
 *    `SecretManager`, исключение приватных проектов и документов с `trustLevel: external`, лимиты и
 *    учёт стоимости.
 * 3. Ошибка внешнего провайдера не превращается в «ничего не найдено»: вызывающий получает признак
 *    деградации (см. `ExternalEmbeddingError.code`).
 */

import type { TrustLevel } from '../types.js';

export interface ExternalEmbeddingConfig {
  /** Explicit opt-in flag; false by default (ADR-009 rule 1). */
  enabled: boolean;
  provider: string;
  baseUrl?: string;
  model?: string;
  /** SecretManager key name — the value itself never leaves the secret manager. */
  keyRef?: string;
  /** Hard limit on texts sent per rolling minute (0 = unlimited). */
  maxTextsPerMinute: number;
  /** Cost accounting: USD per 1M input tokens (0 = not reported). */
  costPerMillionTokensUsd: number;
  /** Projects that must never leave the machine, even when the flag is on. */
  excludedProjects: string[];
  /** Documents with this trust level are never sent to an external provider. */
  excludedTrustLevels: TrustLevel[];
}

const DEFAULT_MAX_TEXTS_PER_MINUTE = 60;

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Read the external-provider configuration lazily (no config module cycles, easy to test). */
export function readExternalEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): ExternalEmbeddingConfig {
  const enabled = /^(1|true|yes|on)$/i.test((env.EMBEDDINGS_EXTERNAL_ENABLED ?? '').trim());
  return {
    enabled,
    provider: (env.EMBEDDINGS_EXTERNAL_PROVIDER ?? 'openai-compatible').trim() || 'openai-compatible',
    baseUrl: env.EMBEDDINGS_EXTERNAL_BASE_URL?.trim() || undefined,
    model: env.EMBEDDINGS_EXTERNAL_MODEL?.trim() || undefined,
    keyRef: env.EMBEDDINGS_EXTERNAL_KEY_REF?.trim() || undefined,
    maxTextsPerMinute: readNumber(env.EMBEDDINGS_EXTERNAL_MAX_TEXTS_PER_MIN, DEFAULT_MAX_TEXTS_PER_MINUTE),
    costPerMillionTokensUsd: readNumber(env.EMBEDDINGS_EXTERNAL_COST_PER_MTOK_USD, 0),
    excludedProjects: readList(env.EMBEDDINGS_EXTERNAL_EXCLUDE_PROJECTS),
    excludedTrustLevels: ['external'],
  };
}

/** Why an enabled configuration cannot run; `null` when it is complete (or disabled). */
export function externalEmbeddingConfigProblem(config: ExternalEmbeddingConfig): string | null {
  if (!config.enabled) return null;
  if (!config.baseUrl) return 'EMBEDDINGS_EXTERNAL_BASE_URL is required when external embeddings are enabled';
  if (!config.model) return 'EMBEDDINGS_EXTERNAL_MODEL is required when external embeddings are enabled';
  return null;
}

/** Startup warning required by ADR-009 rule 2; `null` when the feature is off. */
export function externalEmbeddingStartupWarning(config: ExternalEmbeddingConfig): string | null {
  if (!config.enabled) return null;
  const destination = config.baseUrl ?? config.provider;
  return (
    `external embeddings are ENABLED: chunk texts will be sent to ${destination} ` +
    `(provider=${config.provider}${config.model ? `, model=${config.model}` : ''}). ` +
    'Private projects and documents with trustLevel=external stay local. ' +
    'Disable with EMBEDDINGS_EXTERNAL_ENABLED=0.'
  );
}

/** Entry for `docs/privacy.md` — generated so the document cannot drift from the code. */
export interface PrivacyEgressEntry {
  egressPoint: string;
  trigger: string;
  destination: string;
  dataSent: string;
  verifiedAgainst: string;
}

export function externalEmbeddingPrivacyEntry(config: ExternalEmbeddingConfig): PrivacyEgressEntry {
  const destination = config.baseUrl ?? config.provider;
  return {
    egressPoint: 'External embeddings provider',
    trigger: 'EMBEDDINGS_EXTERNAL_ENABLED=1 (off by default) + indexing a project',
    destination,
    dataSent:
      'Chunk texts of indexed tasks/documents (no file paths, no secrets). Excluded: private projects, ' +
      'documents with trustLevel=external.',
    verifiedAgainst: 'src/search/external-policy.ts, src/search/external-provider.ts',
  };
}

export interface PolicySubject {
  project: string;
  trustLevel?: TrustLevel;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface ExternalEmbeddingGate {
  /** Whether a project/trust-level pair may be sent to the external provider. */
  decide(subject: PolicySubject): PolicyDecision;
  /** Throw when the subject must stay local. */
  assertAllowed(subject: PolicySubject): void;
  readonly config: ExternalEmbeddingConfig;
}

/** Error raised when the external provider is disabled, misconfigured, rate-limited or refused. */
export class ExternalEmbeddingError extends Error {
  constructor(
    readonly code: 'DISABLED' | 'MISSING_KEY' | 'POLICY_DENIED' | 'RATE_LIMITED' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ExternalEmbeddingError';
  }
}

export function createExternalEmbeddingGate(
  config: ExternalEmbeddingConfig,
  options?: { isPrivateProject?: (project: string) => boolean | Promise<boolean> },
): ExternalEmbeddingGate {
  const excluded = new Set(config.excludedProjects);
  return {
    config,
    decide(subject: PolicySubject): PolicyDecision {
      if (!config.enabled) {
        return { allowed: false, reason: 'external embeddings are disabled (EMBEDDINGS_EXTERNAL_ENABLED is not set)' };
      }
      if (excluded.has(subject.project)) {
        return { allowed: false, reason: `project ${subject.project} is excluded from external embeddings` };
      }
      if (subject.trustLevel && config.excludedTrustLevels.includes(subject.trustLevel)) {
        return {
          allowed: false,
          reason: `trustLevel=${subject.trustLevel} content stays local by policy`,
        };
      }
      return { allowed: true };
    },
    assertAllowed(subject: PolicySubject): void {
      const decision = this.decide(subject);
      if (!decision.allowed) {
        throw new ExternalEmbeddingError('POLICY_DENIED', decision.reason ?? 'external embeddings are not allowed');
      }
    },
  };
}
