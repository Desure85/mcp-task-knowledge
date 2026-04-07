/**
 * AuthManager — Authentication gate and pre-auth method window (A-001)
 *
 * Provides a pre-authentication gating mechanism for multi-client transports.
 * Before a session is authenticated, only whitelisted methods are allowed.
 * After `mcp.authenticate` succeeds, all methods are available and the
 * userId is stored in session metadata and propagated via ToolContext.
 *
 * Architecture:
 *   Client connects → SessionManager.create()
 *                     ↓
 *                  Pre-auth window (only whitelist methods allowed)
 *                     ↓
 *   Client calls mcp.authenticate(token) → AuthManager.authenticate()
 *                     ↓ success
 *                  Session authenticated (userId set in metadata)
 *                     ↓
 *                  All tools available + userId in ToolContext
 *
 * Pre-auth method window:
 *   - mcp.authenticate: always allowed
 *   - tools/list: always allowed (client needs to discover authenticate)
 *   - tools/call: DENIED unless session is authenticated
 *   - All other tools: DENIED unless session is authenticated
 *
 * Configuration:
 *   - requireAuth: boolean (default: false for stdio, true for TCP/HTTP)
 *   - authMethods: string[] — additional methods allowed pre-auth
 *   - tokenValidator: async function to validate auth tokens
 *
 * Integration points:
 *   - ToolExecutor pre-hook: gate tool calls
 *   - SessionManager metadata: store userId after auth
 *   - ToolContext.userId: populated from session metadata
 *   - EventBus: emit session.authenticated event
 *
 * Usage:
 *   const auth = new AuthManager({
 *     requireAuth: true,
 *     tokenValidator: async (token) => {
 *       if (token === 'secret') return { userId: 'user-1', roles: ['admin'] };
 *       return null; // invalid
 *     },
 *   });
 *   executor.addPreHook(auth.createPreHook());
 */

import type { SessionManager, SessionInfo } from './session-manager.js';
import type { ToolContext, PreToolHook } from './tool-executor.js';
import { ToolDeniedError } from './tool-executor.js';
import { childLogger } from './logger.js';

const log = childLogger('auth');

// ─── Types ────────────────────────────────────────────────────────────

/** Result of token validation. */
export interface AuthResult {
  /** Authenticated user ID. */
  userId: string;
  /** User roles (for ACL). Default: []. */
  roles?: string[];
  /** Optional additional metadata to store in session. */
  metadata?: Record<string, unknown>;
}

/**
 * Token validator function.
 * Receives the raw token string and returns AuthResult if valid, or null if invalid.
 */
export type TokenValidator = (token: string) => Promise<AuthResult | null>;

/** Options for AuthManager. */
export interface AuthManagerOptions {
  /**
   * Whether authentication is required for tool calls.
   * Default: false (backward compat — stdio mode doesn't require auth).
   */
  requireAuth?: boolean;

  /**
   * Methods allowed before authentication (in addition to built-in whitelist).
   * Built-in whitelist: ['mcp.authenticate', 'tools/list', 'ping'].
   */
  authMethods?: string[];

  /**
   * Token validation function.
   * Called with the token from mcp.authenticate().
   * Must return AuthResult for valid tokens, null for invalid.
   *
   * For A-002 (JWT/JWKS), this will be a JWT validator.
   * For simple deployments, this can check against env vars or a config.
   */
  tokenValidator?: TokenValidator;

  /**
   * SessionManager instance (for setting userId in session metadata).
   * If provided, authenticate() will update the session's metadata.
   */
  sessionManager?: SessionManager;
}

/** Error thrown when authentication fails. */
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Error thrown when token validation fails. */
export class InvalidTokenError extends AuthError {
  constructor(message: string = 'invalid token') {
    super('INVALID_TOKEN', message);
  }
}

/** Error thrown when session is not authenticated but auth is required. */
export class NotAuthenticatedError extends AuthError {
  constructor(message: string = 'authentication required') {
    super('NOT_AUTHENTICATED', message);
  }
}

// ─── AuthManager ─────────────────────────────────────────────────────

/**
 * Manages authentication state and provides pre-auth gating.
 *
 * Tracks which sessions are authenticated and gates tool calls
 * through a whitelist before authentication.
 */
export class AuthManager {
  private readonly requireAuth: boolean;
  private readonly preAuthMethods: Set<string>;
  private readonly tokenValidator?: TokenValidator;
  private readonly sessionManager?: SessionManager;
  private readonly authenticatedSessions = new Set<string>();

  // Default whitelist: methods allowed before auth
  private static readonly DEFAULT_WHITELIST = new Set([
    'mcp.authenticate',
    'tools/list',
    'ping',
  ]);

  constructor(options?: AuthManagerOptions) {
    this.requireAuth = options?.requireAuth ?? false;
    this.tokenValidator = options?.tokenValidator;
    this.sessionManager = options?.sessionManager;

    // Build pre-auth method whitelist
    this.preAuthMethods = new Set(AuthManager.DEFAULT_WHITELIST);
    if (options?.authMethods) {
      for (const method of options.authMethods) {
        this.preAuthMethods.add(method);
      }
    }
  }

  /**
   * Check if authentication is required.
   */
  isAuthRequired(): boolean {
    return this.requireAuth;
  }

  /**
   * Check if a session is authenticated.
   */
  isAuthenticated(sessionId: string): boolean {
    return this.authenticatedSessions.has(sessionId);
  }

  /**
   * Get set of authenticated session IDs (for diagnostics).
   */
  getAuthenticatedSessionIds(): ReadonlySet<string> {
    return this.authenticatedSessions;
  }

  /**
   * Get count of authenticated sessions.
   */
  get authenticatedCount(): number {
    return this.authenticatedSessions.size;
  }

  /**
   * Authenticate a session with a token.
   *
   * Validates the token using the configured tokenValidator.
   * On success:
   *   - Session is marked as authenticated
   *   - userId is stored in session metadata (via SessionManager)
   *   - Roles are stored in session metadata
   *
   * @param sessionId — session to authenticate
   * @param token — authentication token/credential
   * @returns AuthResult with userId and roles
   * @throws InvalidTokenError if token is invalid
   * @throws AuthError if no token validator configured
   */
  async authenticate(sessionId: string, token: string): Promise<AuthResult> {
    if (!this.tokenValidator) {
      throw new AuthError('NO_VALIDATOR', 'no token validator configured');
    }

    const result = await this.tokenValidator(token);
    if (!result) {
      log.warn({ sessionId }, 'authentication failed — invalid token');
      throw new InvalidTokenError();
    }

    // Mark session as authenticated
    this.authenticatedSessions.add(sessionId);
    log.info(
      { sessionId, userId: result.userId, roles: result.roles ?? [] },
      'session authenticated',
    );

    // Update session metadata via SessionManager
    if (this.sessionManager) {
      this.sessionManager.updateMetadata(sessionId, {
        userId: result.userId,
        roles: result.roles ?? [],
        authenticatedAt: new Date().toISOString(),
        ...(result.metadata ?? {}),
      });
    }

    return result;
  }

  /**
   * Manually mark a session as authenticated (e.g. for trusted connections).
   * Bypasses token validation.
   */
  grantSession(sessionId: string, userId: string, roles?: string[]): void {
    this.authenticatedSessions.add(sessionId);
    log.info({ sessionId, userId, roles: roles ?? [] }, 'session granted (manual)');

    if (this.sessionManager) {
      this.sessionManager.updateMetadata(sessionId, {
        userId,
        roles: roles ?? [],
        authenticatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Revoke a session's authentication (e.g. on logout or token expiry).
   */
  revokeSession(sessionId: string): void {
    const was = this.authenticatedSessions.has(sessionId);
    this.authenticatedSessions.delete(sessionId);
    if (was) {
      log.info({ sessionId }, 'session auth revoked');

      // Clean up session metadata
      if (this.sessionManager) {
        this.sessionManager.updateMetadata(sessionId, {
          userId: undefined,
          roles: undefined,
          authenticatedAt: undefined,
        } as any);
      }
    }
  }

  /**
   * Revoke all authenticated sessions (shutdown).
   */
  revokeAll(): void {
    const count = this.authenticatedSessions.size;
    this.authenticatedSessions.clear();
    if (count > 0) {
      log.info({ count }, 'all sessions auth revoked');
    }
  }

  /**
   * Extract userId from session metadata.
   * Returns undefined if not authenticated or no userId found.
   */
  getUserId(sessionId: string): string | undefined {
    if (!this.sessionManager) {
      return this.authenticatedSessions.has(sessionId) ? '__authenticated__' : undefined;
    }
    const session = this.sessionManager.get(sessionId);
    return session?.metadata?.userId as string | undefined;
  }

  /**
   * Extract roles from session metadata.
   */
  getRoles(sessionId: string): string[] {
    if (!this.sessionManager) return [];
    const session = this.sessionManager.get(sessionId);
    return (session?.metadata?.roles as string[]) ?? [];
  }

  /**
   * Check if a method is allowed before authentication.
   */
  isPreAuthMethod(toolName: string): boolean {
    return this.preAuthMethods.has(toolName);
  }

  /**
   * Get list of pre-auth allowed methods (for diagnostics/tools_list filtering).
   */
  getPreAuthMethods(): string[] {
    return [...this.preAuthMethods];
  }

  // ─── Pre-hook factory ────────────────────────────────────────────

  /**
   * Create a pre-execution hook for ToolExecutor.
   *
   * When requireAuth=true, blocks all tool calls except pre-auth methods
   * until the session is authenticated.
   *
   * Also populates context.userId and context.roles from session metadata.
   *
   * @example
   *   const auth = new AuthManager({ requireAuth: true, tokenValidator: ... });
   *   executor.addPreHook(auth.createPreHook());
   */
  createPreHook(): PreToolHook {
    return (toolName: string, _input: Record<string, unknown>, context: ToolContext) => {
      // If auth not required, allow everything
      if (!this.requireAuth) return { deny: false };

      const { sessionId } = context;

      // Allow pre-auth methods
      if (this.preAuthMethods.has(toolName)) {
        return { deny: false };
      }

      // Check if session is authenticated
      if (!this.authenticatedSessions.has(sessionId)) {
        log.warn(
          { toolName, sessionId },
          'tool call denied — not authenticated (pre-auth window)',
        );
        return {
          deny: true,
          reason: `authentication required — call mcp.authenticate first`,
        };
      }

      // Session is authenticated — allow
      return { deny: false };
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Create a simple static token validator.
 * Validates against a map of token → AuthResult.
 *
 * @example
 *   const validator = createStaticValidator({
 *     'my-secret-token': { userId: 'admin', roles: ['admin'] },
 *     'user-token': { userId: 'user-1', roles: [] },
 *   });
 */
export function createStaticValidator(tokens: Record<string, AuthResult | { userId: string; roles?: string[] }>): TokenValidator {
  return async (token: string) => {
    const result = tokens[token];
    if (!result) return null;
    return {
      userId: result.userId,
      roles: result.roles ?? [],
    };
  };
}
