/**
 * T-01b: personal access tokens as an AuthManager `TokenValidator`.
 *
 * `UserStore.verifyToken` already enforces revocation/expiry/disabled. This adapter keeps the
 * validator surface small and allows composing it with JWT/static validators: a personal token is
 * tried first, the existing validator remains the fallback.
 */

import type { TokenValidator } from '../core/auth.js';
import type { UserStore } from './user-store.js';

export function createUserTokenValidator(store: UserStore): TokenValidator {
  return async (token: string) => {
    const user = store.verifyToken(token);
    if (!user) return null;
    return {
      userId: user.userId,
      roles: user.roles,
      metadata: { authMethod: 'personal-token', username: user.username },
    };
  };
}

/** Try validators in order; return the first non-null result. */
export function composeTokenValidators(...validators: TokenValidator[]): TokenValidator {
  return async (token: string) => {
    for (const validator of validators) {
      const result = await validator(token);
      if (result) return result;
    }
    return null;
  };
}
