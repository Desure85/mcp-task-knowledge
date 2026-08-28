/**
 * skills/skill-manager.ts — Skills CRUD with versioning (SK-001).
 *
 * Create, read, update, delete skills with full version history.
 * Skills are Markdown + YAML frontmatter with $ARGUMENTS and ${VARS} support.
 *
 * Storage: JSON file on disk (default: .skills/skills.json)
 *
 * Usage:
 *   const mgr = new SkillManager({ storagePath: '.skills' });
 *   const skill = mgr.create({ name: 'code-review', description: '...', body: '...' });
 *   mgr.update(skill.id, { body: 'new content', changelog: 'improved' });
 *   const all = mgr.list();
 *   const found = mgr.search('review');
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { Skill, CreateSkillInput, UpdateSkillInput, SkillVersion, SkillStatus } from './types.js';

const log = childLogger('skill-manager');

// ─── Storage ──────────────────────────────────────────────────────

interface SkillStorage {
  skills: Record<string, Skill>;
}

// ─── SkillManager ─────────────────────────────────────────────────

export class SkillManager {
  private readonly storagePath: string;
  private readonly filePath: string;
  private storage: SkillStorage;

  constructor(options?: { storagePath?: string }) {
    this.storagePath = options?.storagePath ?? '.skills';
    this.filePath = join(this.storagePath, 'skills.json');
    this.storage = this.load();
  }

  /**
   * Create a new skill.
   */
  create(input: CreateSkillInput): Skill {
    const id = this.slugify(input.name);
    if (this.storage.skills[id]) {
      throw new Error(`[skill-manager] skill already exists: ${id}`);
    }

    const now = new Date().toISOString();
    const version = '1.0.0';
    const skill: Skill = {
      id,
      name: input.name,
      description: input.description,
      body: input.body,
      tags: input.tags ?? [],
      status: 'draft',
      version,
      versions: [{ version, createdAt: now, createdBy: input.createdBy, changelog: 'Initial version' }],
      frontmatter: input.frontmatter ?? {},
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    };

    this.storage.skills[id] = skill;
    this.save();
    log.info({ id, name: input.name }, 'skill created');
    return skill;
  }

  /**
   * Get a skill by ID.
   */
  get(id: string): Skill | undefined {
    return this.storage.skills[id];
  }

  /**
   * Update a skill. Creates a new version if body or significant fields change.
   */
  update(id: string, input: UpdateSkillInput): Skill {
    const skill = this.storage.skills[id];
    if (!skill) {
      throw new Error(`[skill-manager] skill not found: ${id}`);
    }

    const now = new Date().toISOString();
    const oldBody = skill.body;

    // Apply updates
    if (input.name !== undefined) skill.name = input.name;
    if (input.description !== undefined) skill.description = input.description;
    if (input.body !== undefined) skill.body = input.body;
    if (input.tags !== undefined) skill.tags = input.tags;
    if (input.status !== undefined) skill.status = input.status;
    if (input.frontmatter !== undefined) skill.frontmatter = input.frontmatter;
    skill.updatedAt = now;

    // Create new version if body changed
    if (input.body !== undefined && input.body !== oldBody) {
      const newVersion = this.bumpVersion(skill.version);
      const versionRecord: SkillVersion = {
        version: newVersion,
        createdAt: now,
        createdBy: input.createdBy,
        changelog: input.changelog ?? 'Updated body',
      };
      skill.version = newVersion;
      skill.versions.push(versionRecord);
    }

    this.save();
    log.info({ id, version: skill.version }, 'skill updated');
    return skill;
  }

  /**
   * Delete a skill.
   */
  delete(id: string): boolean {
    if (!this.storage.skills[id]) return false;
    delete this.storage.skills[id];
    this.save();
    log.info({ id }, 'skill deleted');
    return true;
  }

  /**
   * List all skills, optionally filtered by status or tag.
   */
  list(filter?: { status?: SkillStatus; tag?: string }): Skill[] {
    let skills = Object.values(this.storage.skills);
    if (filter?.status) {
      skills = skills.filter((s) => s.status === filter.status);
    }
    if (filter?.tag) {
      skills = skills.filter((s) => s.tags.includes(filter.tag!));
    }
    return skills.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }

  /**
   * Search skills by text in name, description, or body.
   */
  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Object.values(this.storage.skills).filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.body.toLowerCase().includes(lower),
    );
  }

  /**
   * Get version history for a skill.
   */
  getHistory(id: string): SkillVersion[] {
    const skill = this.storage.skills[id];
    if (!skill) return [];
    return [...skill.versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Rollback to a specific version.
   * Note: Only restores version metadata, not body content (bodies are not stored per-version).
   */
  rollback(id: string, version: string): Skill | undefined {
    const skill = this.storage.skills[id];
    if (!skill) return undefined;
    const v = skill.versions.find((ver) => ver.version === version);
    if (!v) return undefined;
    skill.version = version;
    skill.updatedAt = new Date().toISOString();
    this.save();
    log.info({ id, version }, 'skill rolled back');
    return skill;
  }

  /**
   * Activate a skill (change status from draft to active).
   */
  activate(id: string): Skill | undefined {
    return this.setStatus(id, 'active');
  }

  /**
   * Deprecate a skill.
   */
  deprecate(id: string): Skill | undefined {
    return this.setStatus(id, 'deprecated');
  }

  /**
   * Archive a skill.
   */
  archive(id: string): Skill | undefined {
    return this.setStatus(id, 'archived');
  }

  /**
   * Get count of skills.
   */
  get count(): number {
    return Object.keys(this.storage.skills).length;
  }

  /**
   * Clear all skills.
   */
  clear(): void {
    this.storage = { skills: {} };
    this.save();
  }

  // ─── Internal ───────────────────────────────────────────────────

  private setStatus(id: string, status: SkillStatus): Skill | undefined {
    const skill = this.storage.skills[id];
    if (!skill) return undefined;
    skill.status = status;
    skill.updatedAt = new Date().toISOString();
    this.save();
    return skill;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private bumpVersion(version: string): string {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return `${version}.1`;
    parts[2]++;
    return parts.join('.');
  }

  private load(): SkillStorage {
    try {
      if (existsSync(this.filePath)) {
        return JSON.parse(readFileSync(this.filePath, 'utf8')) as SkillStorage;
      }
    } catch (err) {
      log.warn({ err }, 'failed to load skills, starting fresh');
    }
    return { skills: {} };
  }

  private save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch (err) {
      log.error({ err }, 'failed to save skills');
    }
  }
}
