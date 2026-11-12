/**
 * Y-02e2 — single accessor for the storage profile of a server context.
 *
 * Production contexts always carry a profile: `createServerContext()` (the factory `AppContainer`
 * uses) builds the file profile and publishes it. Registrators therefore read storage from here
 * instead of importing `src/storage/*`.
 *
 * Hand-built test mocks may omit `storage`; instead of forcing every test to construct a profile,
 * the accessor lazily attaches the default file profile to that context. The guard test in
 * `tests/storage-wiring.test.ts` still asserts that a *real* context has a profile, so the fallback
 * cannot hide a wiring regression in production.
 */

import { createFileProfile } from '../storage/profiles/file/index.js';
import type { StorageProfile } from '../storage/contracts.js';

// Y-02e: registrators import storage-facing constants/types through this composition-root module,
// not from `src/storage/**`.
export {
  DEFAULT_CLAIM_TTL_SEC,
  MAX_TASK_DEPTH,
  MAX_CLAIM_TTL_SEC,
  MIN_CLAIM_TTL_SEC,
} from '../storage/contracts.js';
export type { ClaimActor } from '../storage/contracts.js';

export interface StorageCarrier {
  storage?: StorageProfile;
}

/** Return the context profile, attaching the default file profile to hand-built test carriers. */
export function storageProfile(ctx: StorageCarrier): StorageProfile {
  if (!ctx.storage) ctx.storage = createFileProfile();
  return ctx.storage;
}
