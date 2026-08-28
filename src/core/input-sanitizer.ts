/**
 * core/input-sanitizer.ts — Input sanitization middleware (SEC-006).
 *
 * Validates and sanitizes all tool input to prevent:
 *   - XSS (cross-site scripting)
 *   - SQL injection
 *   - Path traversal
 *   - Command injection
 *
 * Implemented as a ToolMiddleware that runs in the MW-001 pipeline.
 * Inspects ctx.input before the handler runs, sanitizes or rejects.
 *
 * Usage:
 *   const sanitizer = new InputSanitizerMiddleware();
 *   pipeline.use(sanitizer);
 *
 * Configuration:
 *   - mode: 'sanitize' (clean and continue) | 'reject' (deny on detection)
 *   - customPatterns: additional regex patterns to detect
 */

import type { ToolMiddleware, MiddlewareContext, BeforeResult } from './middleware.js';
import { childLogger } from './logger.js';

const log = childLogger('input-sanitizer');

// ─── Sanitizer Config ─────────────────────────────────────────────

export type SanitizerMode = 'sanitize' | 'reject';

export interface SanitizerConfig {
  /** Mode: 'sanitize' cleans input, 'reject' denies the call. Default: 'sanitize'. */
  mode?: SanitizerMode;
  /** Max input string length (0 = no limit). Default: 0. */
  maxStringLength?: number;
  /** Max nesting depth for objects. Default: 10. */
  maxDepth?: number;
  /** Max number of keys per object. Default: 100. */
  maxKeys?: number;
  /** Max array length. Default: 1000. */
  maxArrayLength?: number;
  /** Custom detection patterns (regex). */
  customPatterns?: RegExp[];
  /** Field names to skip sanitization (allowlist). */
  skipFields?: string[];
}

export const DEFAULT_SANITIZER_CONFIG: Required<SanitizerConfig> = {
  mode: 'sanitize',
  maxStringLength: 0,
  maxDepth: 10,
  maxKeys: 100,
  maxArrayLength: 1000,
  customPatterns: [],
  skipFields: [],
};

// ─── Detection Patterns ───────────────────────────────────────────

/** SQL injection patterns. */
const SQL_PATTERNS: RegExp[] = [
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,        // OR 1=1
  /(\b(OR|AND)\b\s+'[^']*'\s*=\s*'[^']*')/i, // OR 'a'='a'
  /(--\s|\/\*|\*\/|;)/,                       // SQL comments / statement end
  /\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b\s+/i,
];

/** XSS patterns. */
const XSS_PATTERNS: RegExp[] = [
  /<script\b[^>]*>/i,
  /<\/script>/i,
  /javascript:/i,
  /on\w+\s*=\s*["']/i,  // onclick=, onload=, etc.
  /<iframe\b[^>]*>/i,
  /<object\b[^>]*>/i,
  /<embed\b[^>]*>/i,
  /<svg\b[^>]*>/i,
];

/** Path traversal patterns. */
const PATH_TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\.\//g,    // ../
  /\.\.\\/g,    // ..\
  /%2e%2e/gi,   // URL-encoded ..
  /%2f/gi,      // URL-encoded /
  /%5c/gi,      // URL-encoded \
];

/** Command injection patterns. */
const COMMAND_INJECTION_PATTERNS: RegExp[] = [
  /[;&|`$(){}]/g,           // shell metacharacters
  /\$\(/g,                   // command substitution
  /`[^`]*`/g,                // backtick command substitution
  /\|\s*\w+/g,               // pipe to command
  /&&\s*\w+/g,               // AND command
  /\|\|\s*\w+/g,             // OR command
];

const ALL_PATTERNS = [
  ...SQL_PATTERNS,
  ...XSS_PATTERNS,
  ...PATH_TRAVERSAL_PATTERNS,
  ...COMMAND_INJECTION_PATTERNS,
];

// ─── Sanitization Functions ───────────────────────────────────────

export type ThreatType = 'sql_injection' | 'xss' | 'path_traversal' | 'command_injection' | 'custom' | 'size_limit';

export interface SanitizationResult {
  /** Whether a threat was detected. */
  detected: boolean;
  /** Type of threat detected. */
  threatType?: ThreatType;
  /** The sanitized value (if mode=sanitize). */
  value?: unknown;
  /** The field path where threat was detected. */
  path?: string;
  /** Description of the threat. */
  description?: string;
}

/**
 * Sanitize a string value.
 * Removes or escapes dangerous patterns.
 */
export function sanitizeString(str: string): string {
  return str
    // Remove script tags
    .replace(/<script\b[^>]*>.*?<\/script>/gis, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<\/script>/gi, '')
    // Remove event handlers (before HTML escaping)
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Escape HTML entities for XSS prevention
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Remove path traversal
    .replace(/\.\.\//g, '')
    .replace(/\.\.\\/g, '')
    // Remove command injection metacharacters
    .replace(/[`$(){}]/g, '')
    // Neutralize SQL comment markers
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '');
}

/**
 * Detect threats in a string value.
 */
export function detectThreats(
  str: string,
  customPatterns: RegExp[] = [],
): { type: ThreatType; pattern: RegExp } | null {
  // Check SQL injection
  for (const pattern of SQL_PATTERNS) {
    if (pattern.test(str)) return { type: 'sql_injection', pattern };
  }

  // Check XSS
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(str)) return { type: 'xss', pattern };
  }

  // Check path traversal
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(str)) return { type: 'path_traversal', pattern };
  }

  // Check command injection
  for (const pattern of COMMAND_INJECTION_PATTERNS) {
    if (pattern.test(str)) return { type: 'command_injection', pattern };
  }

  // Check custom patterns
  for (const pattern of customPatterns) {
    if (pattern.test(str)) return { type: 'custom', pattern };
  }

  return null;
}

/**
 * Recursively sanitize an object/value.
 */
export function sanitizeValue(
  value: unknown,
  config: Required<SanitizerConfig>,
  path = '',
  depth = 0,
): SanitizationResult {
  // Check depth
  if (depth > config.maxDepth) {
    return { detected: true, threatType: 'size_limit', path, description: 'max depth exceeded' };
  }

  if (value === null || value === undefined) {
    return { detected: false, value };
  }

  if (typeof value === 'string') {
    // Check string length
    if (config.maxStringLength > 0 && value.length > config.maxStringLength) {
      return {
        detected: true,
        threatType: 'size_limit',
        path,
        description: `string length ${value.length} exceeds max ${config.maxStringLength}`,
      };
    }

    // Detect threats
    const threat = detectThreats(value, config.customPatterns);
    if (threat) {
      if (config.mode === 'reject') {
        return {
          detected: true,
          threatType: threat.type,
          path,
          description: `${threat.type} detected in ${path || 'input'}`,
        };
      }
      // Sanitize mode: clean the string
      return { detected: true, threatType: threat.type, path, value: sanitizeString(value) };
    }

    return { detected: false, value };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { detected: false, value };
  }

  if (Array.isArray(value)) {
    if (value.length > config.maxArrayLength) {
      return {
        detected: true,
        threatType: 'size_limit',
        path,
        description: `array length ${value.length} exceeds max ${config.maxArrayLength}`,
      };
    }

    const result: unknown[] = [];
    let detected = false;
    let firstDetection: SanitizationResult | undefined;
    for (let i = 0; i < value.length; i++) {
      const itemResult = sanitizeValue(value[i], config, `${path}[${i}]`, depth + 1);
      if (itemResult.detected) {
        detected = true;
        if (!firstDetection) firstDetection = itemResult;
        if (config.mode === 'reject' && itemResult.threatType !== undefined) {
          return itemResult;
        }
      }
      result.push(itemResult.value);
    }
    return { detected, value: result, ...(firstDetection?.threatType ? { threatType: firstDetection.threatType, path: firstDetection.path } : {}) };
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length > config.maxKeys) {
      return {
        detected: true,
        threatType: 'size_limit',
        path,
        description: `object keys ${keys.length} exceeds max ${config.maxKeys}`,
      };
    }

    const result: Record<string, unknown> = {};
    let detected = false;
    let firstDetection: SanitizationResult | undefined;
    for (const key of keys) {
      if (config.skipFields.includes(key)) {
        result[key] = obj[key];
        continue;
      }
      const childPath = path ? `${path}.${key}` : key;
      const childResult = sanitizeValue(obj[key], config, childPath, depth + 1);
      if (childResult.detected) {
        detected = true;
        if (!firstDetection) firstDetection = childResult;
        if (config.mode === 'reject' && childResult.threatType !== undefined) {
          return childResult;
        }
      }
      result[key] = childResult.value;
    }
    return { detected, value: result, ...(firstDetection?.threatType ? { threatType: firstDetection.threatType, path: firstDetection.path } : {}) };
  }

  return { detected: false, value };
}

// ─── Middleware ───────────────────────────────────────────────────

/**
 * Middleware that sanitizes or rejects tool input based on configured patterns.
 */
export class InputSanitizerMiddleware implements ToolMiddleware {
  readonly name = 'input-sanitizer';
  private readonly config: Required<SanitizerConfig>;

  constructor(config?: SanitizerConfig) {
    this.config = { ...DEFAULT_SANITIZER_CONFIG, ...config };
  }

  async before(ctx: MiddlewareContext): Promise<BeforeResult | undefined> {
    const result = sanitizeValue(ctx.input, this.config);

    if (result.detected) {
      if (this.config.mode === 'reject') {
        log.warn(
          { toolName: ctx.toolName, threatType: result.threatType, path: result.path },
          'input rejected by sanitizer',
        );
        ctx.shortCircuit({
          error: `input validation failed: ${result.description}`,
        });
        return { shortCircuit: { error: result.description } };
      }

      // Sanitize mode: replace input with sanitized version
      log.info(
        { toolName: ctx.toolName, threatType: result.threatType, path: result.path },
        'input sanitized',
      );
      if (result.value !== undefined) {
        ctx.input = result.value as Record<string, unknown>;
      }
    }

    return undefined;
  }
}
