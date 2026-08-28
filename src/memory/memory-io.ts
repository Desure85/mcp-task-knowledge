/**
 * memory/memory-io.ts — Memory import/export (MEM-004).
 *
 * Export session memory to standard formats (Markdown, JSON) and import
 * conventions/decisions/sessions from .claude/, .cursor/, and Obsidian vaults.
 *
 * Usage:
 *   const io = new MemoryIO(memory);
 *   const markdown = io.exportMarkdown();
 *   const json = io.exportJson();
 *   io.importJson(json);
 *   const summary = io.importFromClaudeDir('.claude');
 *   const summary2 = io.importFromObsidianDir('vault/knowledge');
 */

import matter from 'gray-matter';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { childLogger } from '../core/logger.js';
import type { SessionMemory } from './session-memory.js';
import type { SessionRecord, SessionDecision } from './session-memory.js';

const log = childLogger('memory-io');

// ─── Types ────────────────────────────────────────────────────────

export interface ImportSummary {
  sessionsImported: number;
  conventionsAdded: number;
  decisionsImported: number;
  skipped: { source: string; reason: string }[];
}

export interface ImportOptions {
  /** Source attribution for imported sessions. */
  source?: string;
}

// ─── MemoryIO ─────────────────────────────────────────────────────

export class MemoryIO {
  private readonly memory: SessionMemory;

  constructor(memory: SessionMemory) {
    this.memory = memory;
  }

  // ─── Export ─────────────────────────────────────────────────────

  /**
   * Export all memory as a Markdown document (human-readable standard format).
   */
  exportMarkdown(): string {
    const lines: string[] = ['# Memory Export', ''];
    const sessions = this.memory.getSessions();

    lines.push(`## Sessions (${sessions.length})`, '');
    for (const session of sessions) {
      lines.push(`### ${session.id} — ${session.startedAt}`);
      lines.push(`**Summary:** ${session.summary}`);
      if (session.nextSteps.length > 0) {
        lines.push('**Next steps:**');
        for (const step of session.nextSteps) lines.push(`- ${step}`);
      }
      if (session.filesModified.length > 0) {
        lines.push(`**Files:** ${session.filesModified.join(', ')}`);
      }
      if (session.decisions.length > 0) {
        lines.push('**Decisions:**');
        for (const d of session.decisions) {
          lines.push(`- ${d.title}: ${d.decision} (${d.rationale})`);
        }
      }
      lines.push('');
    }

    const conventions = this.memory.getConventions();
    lines.push(`## Conventions (${conventions.length})`, '');
    for (const c of conventions) lines.push(`- ${c}`);

    return lines.join('\n');
  }

  /**
   * Export all memory as JSON (machine-readable standard format).
   */
  exportJson(): string {
    const sessions = this.memory.getSessions();
    return JSON.stringify({ sessions, conventions: this.memory.getConventions(), version: 1 }, null, 2);
  }

  // ─── Import: JSON ───────────────────────────────────────────────

  /**
   * Import sessions + conventions from exported JSON.
   * Sessions with existing IDs are skipped.
   */
  importJson(content: string, options?: ImportOptions): ImportSummary {
    const summary: ImportSummary = { sessionsImported: 0, conventionsAdded: 0, decisionsImported: 0, skipped: [] };
    let data: { sessions?: SessionRecord[]; conventions?: string[] };
    try {
      data = JSON.parse(content);
    } catch (err) {
      summary.skipped.push({ source: 'json', reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` });
      return summary;
    }

    for (const session of data.sessions ?? []) {
      if (this.memory.getSession(session.id)) {
        summary.skipped.push({ source: session.id, reason: 'already exists' });
        continue;
      }
      this.memory.saveSession(session);
      summary.sessionsImported++;
      summary.decisionsImported += session.decisions?.length ?? 0;
    }

    for (const convention of data.conventions ?? []) {
      if (typeof convention !== 'string') continue;
      this.memory.addConvention(convention);
      summary.conventionsAdded++;
    }
    return summary;
  }

  // ─── Import: text conventions ───────────────────────────────────

  /**
   * Extract conventions from free text: bullet lines ("- item") and
   * frontmatter `conventions` arrays.
   */
  importConventionsFromText(content: string, options?: ImportOptions): ImportSummary {
    const summary: ImportSummary = { sessionsImported: 0, conventionsAdded: 0, decisionsImported: 0, skipped: [] };
    const found = new Set<string>();

    // frontmatter conventions (array or comma-separated string)
    const parsed = matter(content);
    const fmConventions = parsed.data?.conventions;
    if (Array.isArray(fmConventions)) {
      for (const c of fmConventions) {
        if (typeof c === 'string' && c.trim()) found.add(c.trim());
      }
    } else if (typeof fmConventions === 'string') {
      for (const c of fmConventions.split(',')) {
        if (c.trim()) found.add(c.trim());
      }
    }

    // bullet lines in the body
    for (const line of parsed.content.split('\n')) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet && bullet[1].trim()) found.add(bullet[1].trim());
    }

    for (const c of found) {
      this.memory.addConvention(c);
      summary.conventionsAdded++;
    }
    return summary;
  }

  // ─── Import: directories ────────────────────────────────────────

  /**
   * Import conventions from a .claude/ directory (CLAUDE.md + *.md).
   */
  importFromClaudeDir(dir: string): ImportSummary {
    const summary: ImportSummary = { sessionsImported: 0, conventionsAdded: 0, decisionsImported: 0, skipped: [] };
    const files = this.collectFiles(dir, ['.md']);
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        const sub = this.importConventionsFromText(content, { source: file });
        summary.conventionsAdded += sub.conventionsAdded;
      } catch (err) {
        summary.skipped.push({ source: file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return summary;
  }

  /**
   * Import conventions from a .cursor/ directory (.cursorrules files).
   */
  importFromCursorDir(dir: string): ImportSummary {
    const summary: ImportSummary = { sessionsImported: 0, conventionsAdded: 0, decisionsImported: 0, skipped: [] };
    const files = this.collectFiles(dir, ['.cursorrules']);
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        const sub = this.importConventionsFromText(content, { source: file });
        summary.conventionsAdded += sub.conventionsAdded;
      } catch (err) {
        summary.skipped.push({ source: file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return summary;
  }

  /**
   * Import from an Obsidian vault directory: markdown docs with frontmatter
   * `type: convention` (→ conventions) or `type: decision` (→ decisions).
   */
  importFromObsidianDir(dir: string): ImportSummary {
    const summary: ImportSummary = { sessionsImported: 0, conventionsAdded: 0, decisionsImported: 0, skipped: [] };
    const files = this.collectFiles(dir, ['.md']);
    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        const parsed = matter(content);
        const type = parsed.data?.type;
        if (type === 'convention') {
          const text = parsed.content.trim();
          if (text) {
            this.memory.addConvention(text);
            summary.conventionsAdded++;
          }
        } else if (type === 'decision') {
          const decision = this.parseDecision(file, parsed.data, parsed.content);
          if (decision) {
            this.memory.saveSession({
              summary: `Imported decision: ${decision.title}`,
              nextSteps: [],
              filesModified: [],
              decisions: [decision],
              conventions: [],
              metadata: { source: file },
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
            });
            summary.decisionsImported++;
          }
        }
      } catch (err) {
        summary.skipped.push({ source: file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return summary;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private parseDecision(file: string, data: Record<string, unknown>, body: string): SessionDecision | null {
    const title = typeof data.title === 'string' ? data.title : basename(file, extname(file));
    const decision = typeof data.decision === 'string' ? data.decision : body.trim();
    const rationale = typeof data.rationale === 'string' ? data.rationale : '';
    if (!decision) return null;
    return {
      title,
      decision,
      rationale,
      timestamp: new Date().toISOString(),
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : undefined,
    };
  }

  private collectFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) return files;
    const walk = (current: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith('.git') || entry.startsWith('node_modules')) continue;
        const full = join(current, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walk(full);
        } else if (extensions.some((ext) => entry.endsWith(ext))) {
          files.push(full);
        }
      }
    };
    walk(dir);
    return files;
  }
}
