/**
 * skills/types.ts — Skill types (SK-001).
 */

export type SkillStatus = 'draft' | 'active' | 'deprecated' | 'archived';

export interface SkillVersion {
  /** Version number (semver-like: 1.0.0). */
  version: string;
  /** When this version was created (ISO 8601). */
  createdAt: string;
  /** Who created this version. */
  createdBy?: string;
  /** Commit SHA (if versioned in git). */
  commitSha?: string;
  /** Change description. */
  changelog?: string;
}

export interface Skill {
  /** Unique skill ID (slug-based). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Brief description (what the skill does). */
  description: string;
  /** Skill body — Markdown content with $ARGUMENTS and ${VARS} placeholders. */
  body: string;
  /** Tags for categorization. */
  tags: string[];
  /** Skill status. */
  status: SkillStatus;
  /** Current version. */
  version: string;
  /** Version history. */
  versions: SkillVersion[];
  /** YAML frontmatter (arbitrary metadata). */
  frontmatter: Record<string, unknown>;
  /** When the skill was created (ISO 8601). */
  createdAt: string;
  /** When the skill was last updated (ISO 8601). */
  updatedAt: string;
  /** Who created the skill. */
  createdBy?: string;
}

export interface CreateSkillInput {
  name: string;
  description: string;
  body: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
  createdBy?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  body?: string;
  tags?: string[];
  status?: SkillStatus;
  frontmatter?: Record<string, unknown>;
  changelog?: string;
  createdBy?: string;
}
