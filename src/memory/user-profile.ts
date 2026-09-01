/**
 * memory/user-profile.ts — User Profiles (NEXT-004).
 *
 * Auto-maintained always-on context (static + dynamic facts).
 * Inspired by Supermemory: ~50ms retrieval, always-on context.
 *
 * Architecture:
 *   - UserProfile: static facts (name, role, preferences) + dynamic facts (current task, recent decisions)
 *   - ProfileManager: CRUD, auto-extract from memory facts, context injection
 *   - Storage: JSON file per user (consistent with entity-graph pattern)
 *   - Integration: memory_extract → profile auto-update when category=preference
 *
 * Usage:
 *   const mgr = new ProfileManager({ storagePath: '.memory/profiles' });
 *   mgr.updateProfile('alice', { static: { role: 'developer' } });
 *   mgr.addDynamicFact('alice', { statement: 'working on auth module', validFrom: now });
 *   const profile = mgr.getProfile('alice');
 *   const context = mgr.buildContextBlock('alice', 500); // ~500 tokens
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';

const log = childLogger('user-profile');

// ─── Types ──────────────────────────────────────────────────────────

/** A static fact about a user (rarely changes). */
export interface StaticFact {
  /** Fact key (e.g. 'role', 'name', 'timezone'). */
  key: string;
  /** Fact value. */
  value: string;
  /** When set (ISO 8601). */
  setAt: string;
}

/** A dynamic fact about a user (changes frequently). */
export interface DynamicFact {
  /** Unique ID. */
  id: string;
  /** Fact statement. */
  statement: string;
  /** Category. */
  category: string;
  /** When this fact became true (ISO 8601). */
  validFrom: string;
  /** When it stopped being true (null = still valid). */
  validTo?: string;
  /** Whether still valid. */
  valid: boolean;
}

/** A user profile. */
export interface UserProfile {
  /** User ID. */
  userId: string;
  /** Static facts (key→value). */
  static: Record<string, StaticFact>;
  /** Dynamic facts (time-ordered). */
  dynamic: DynamicFact[];
  /** When the profile was created (ISO 8601). */
  createdAt: string;
  /** When last updated (ISO 8601). */
  updatedAt: string;
}

/** Input for updating a profile. */
export interface ProfileUpdateInput {
  /** Static facts to set/overwrite. */
  static?: Record<string, string>;
  /** Dynamic fact to add. */
  dynamicFact?: {
    statement: string;
    category?: string;
  };
}

// ─── ProfileManager ─────────────────────────────────────────────────

export class ProfileManager {
  private readonly storageDir: string;

  constructor(options: { storagePath: string }) {
    this.storageDir = options.storagePath;
    try {
      mkdirSync(this.storageDir, { recursive: true });
    } catch {
      // dir may already exist
    }
  }

  /** File path for a user's profile. */
  private fileFor(userId: string): string {
    return join(this.storageDir, `${userId}.json`);
  }

  /** Load a profile from disk. */
  private load(userId: string): UserProfile | null {
    try {
      const p = this.fileFor(userId);
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf-8'));
      }
    } catch (e) {
      log.warn({ error: e, userId }, 'failed to load profile');
    }
    return null;
  }

  /** Save a profile to disk. */
  private save(profile: UserProfile): void {
    try {
      const p = this.fileFor(profile.userId);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(profile, null, 2));
    } catch (e) {
      log.error({ error: e, userId: profile.userId }, 'failed to save profile');
    }
  }

  /**
   * Get a user profile. Returns null if not found.
   */
  getProfile(userId: string): UserProfile | null {
    return this.load(userId);
  }

  /**
   * Create or update a profile.
   */
  updateProfile(userId: string, input: ProfileUpdateInput): UserProfile {
    const now = new Date().toISOString();
    let profile = this.load(userId);

    if (!profile) {
      profile = {
        userId,
        static: {},
        dynamic: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    // Update static facts
    if (input.static) {
      for (const [key, value] of Object.entries(input.static)) {
        profile.static[key] = { key, value, setAt: now };
      }
    }

    // Add dynamic fact
    if (input.dynamicFact) {
      // Invalidate previous facts of same category (only one "current" fact per category)
      if (input.dynamicFact.category) {
        for (const f of profile.dynamic) {
          if (f.category === input.dynamicFact.category && f.valid) {
            f.valid = false;
            f.validTo = now;
          }
        }
      }

      profile.dynamic.push({
        id: `${userId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        statement: input.dynamicFact.statement,
        category: input.dynamicFact.category ?? 'context',
        validFrom: now,
        valid: true,
      });
    }

    profile.updatedAt = now;
    this.save(profile);

    log.info({ userId, staticCount: Object.keys(profile.static).length, dynamicCount: profile.dynamic.length }, 'profile updated');
    return profile;
  }

  /**
   * Get current valid dynamic facts for a user.
   */
  getValidDynamicFacts(userId: string): DynamicFact[] {
    const profile = this.load(userId);
    if (!profile) return [];
    return profile.dynamic.filter((f) => f.valid);
  }

  /**
   * Build a compact context block for system prompt injection.
   * Budget-aware: limits output to approximately maxTokens.
   */
  buildContextBlock(userId: string, maxTokens: number = 500): string {
    const profile = this.load(userId);
    if (!profile) return '';

    const lines: string[] = [`<user-profile userId="${userId}">`];

    // Static facts
    const staticEntries = Object.entries(profile.static);
    if (staticEntries.length > 0) {
      lines.push('## Static');
      for (const [key, fact] of staticEntries) {
        lines.push(`- ${key}: ${fact.value}`);
      }
    }

    // Dynamic facts (valid only)
    const dynamicFacts = profile.dynamic.filter((f) => f.valid);
    if (dynamicFacts.length > 0) {
      lines.push('## Current Context');
      for (const fact of dynamicFacts) {
        lines.push(`- [${fact.category}] ${fact.statement}`);
      }
    }

    lines.push('</user-profile>');
    const result = lines.join('\n');

    // Token budget: ~3 chars/token
    const maxChars = maxTokens * 3;
    if (result.length <= maxChars) return result;

    // Truncate: keep static + as many dynamic as fit
    const truncated: string[] = [`<user-profile userId="${userId}">`];
    if (staticEntries.length > 0) {
      truncated.push('## Static');
      for (const [key, fact] of staticEntries) {
        truncated.push(`- ${key}: ${fact.value}`);
      }
    }
    truncated.push('## Current Context');
    let charCount = truncated.join('\n').length;
    for (const fact of dynamicFacts) {
      const line = `- [${fact.category}] ${fact.statement}`;
      if (charCount + line.length + 1 > maxChars) break;
      truncated.push(line);
      charCount += line.length + 1;
    }
    truncated.push('</user-profile>');
    return truncated.join('\n');
  }

  /**
   * List all user IDs that have profiles.
   */
  listUsers(): string[] {
    try {
      const files = readdirSync(this.storageDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Delete a profile.
   */
  deleteProfile(userId: string): boolean {
    const p = this.fileFor(userId);
    if (!existsSync(p)) return false;
    try {
      const { unlinkSync } = require('node:fs');
      unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }
}
