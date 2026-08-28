/**
 * behavioral/code-lineage.ts — Code lineage (BM-006).
 *
 * MCP tool `get_code_lineage` — traces the full generational history of code
 * (parent → child → grandchild chains).
 *
 * Linking rules, in order of precedence:
 *   1. explicit `context.parentMemoryId` on the intent;
 *   2. `context.previousHash` matching the `contentHash` of another intent
 *      for the same file (hash-based linking);
 *   3. implicit — the previous intent captured for the same file.
 *
 * Usage:
 *   const lineage = new CodeLineage(intentCapture);
 *   const result = lineage.trace('intent-abc123');
 *   // result.ancestors — root → parent, result.descendants — child subtree
 */

import type { IntentCapture, IntentRecord } from './intent-capture.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('code-lineage');

// ─── Types ────────────────────────────────────────────────────────

export interface LineageNode {
  /** The intent at this node. */
  intent: IntentRecord;
  /** Distance from the root of the chain (root = 0). */
  generation: number;
  /** Children of this node, oldest first. */
  children: LineageNode[];
}

export interface LineageResult {
  /** The intent the lineage was traced from. */
  intent: IntentRecord;
  /** Root of the whole chain (may be the intent itself). */
  root: IntentRecord;
  /** Ancestors ordered root → direct parent (empty for a root intent). */
  ancestors: IntentRecord[];
  /** Direct parent, if any. */
  parent: IntentRecord | null;
  /** Descendant subtree of the intent. */
  descendants: LineageNode[];
  /** Generation of the intent within its chain (root = 0). */
  generation: number;
  /** Formatted markdown lineage for the AI agent. */
  lineage: string;
}

// ─── CodeLineage ──────────────────────────────────────────────────

export class CodeLineage {
  constructor(private readonly intents: IntentCapture) {}

  /**
   * Trace the full generational history of an intent.
   */
  trace(memoryId: string): LineageResult | null {
    const intent = this.intents.get(memoryId);
    if (!intent) {
      log.warn({ memoryId }, 'intent not found');
      return null;
    }

    const ancestors = this.getAncestors(memoryId);
    const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
    const root = ancestors.length > 0 ? ancestors[0] : intent;
    const generation = ancestors.length;
    const descendants = this.buildSubtree(intent, generation + 1, new Set([intent.memoryId]));

    return {
      intent,
      root,
      ancestors,
      parent,
      descendants,
      generation,
      lineage: this.formatLineage(intent, ancestors, descendants),
    };
  }

  /**
   * Get the direct parent of an intent, or null for a root intent.
   */
  getParent(memoryId: string): IntentRecord | null {
    const intent = this.intents.get(memoryId);
    if (!intent) return null;

    const explicitId = asString(intent.context.parentMemoryId);
    if (explicitId) {
      const explicit = this.intents.get(explicitId);
      if (explicit && explicit.memoryId !== intent.memoryId) return explicit;
    }

    const previousHash = asString(intent.context.previousHash);
    if (previousHash) {
      const byHash = this.intents
        .getByFile(intent.file)
        .find((r) => r.contentHash === previousHash && r.memoryId !== intent.memoryId);
      if (byHash) return byHash;
    }

    const siblings = this.intents.getByFile(intent.file);
    const index = siblings.findIndex((r) => r.memoryId === intent.memoryId);
    return index > 0 ? siblings[index - 1] : null;
  }

  /**
   * Get direct children of an intent, oldest first.
   */
  getChildren(memoryId: string): IntentRecord[] {
    const intent = this.intents.get(memoryId);
    if (!intent) return [];

    return this.intents
      .list()
      .filter((r) => r.memoryId !== memoryId && this.getParent(r.memoryId)?.memoryId === memoryId);
  }

  /**
   * Get ancestors ordered root → direct parent.
   */
  getAncestors(memoryId: string): IntentRecord[] {
    const chain: IntentRecord[] = [];
    const seen = new Set<string>([memoryId]);

    let parent = this.getParent(memoryId);
    while (parent && !seen.has(parent.memoryId)) {
      seen.add(parent.memoryId);
      chain.unshift(parent);
      parent = this.getParent(parent.memoryId);
    }

    return chain;
  }

  /**
   * Get all descendants (flattened, breadth-first).
   */
  getDescendants(memoryId: string): IntentRecord[] {
    const flat: IntentRecord[] = [];
    const walk = (nodes: LineageNode[]): void => {
      for (const node of nodes) {
        flat.push(node.intent);
        walk(node.children);
      }
    };
    const intent = this.intents.get(memoryId);
    if (!intent) return flat;
    walk(this.buildSubtree(intent, 1, new Set([memoryId])));
    return flat;
  }

  /**
   * Get the root of the chain containing an intent.
   */
  getRoot(memoryId: string): IntentRecord | null {
    const intent = this.intents.get(memoryId);
    if (!intent) return null;
    const ancestors = this.getAncestors(memoryId);
    return ancestors.length > 0 ? ancestors[0] : intent;
  }

  /**
   * Get the full chain for a file: root → … → latest, oldest first.
   */
  getFileLineage(file: string): IntentRecord[] {
    return this.intents.getByFile(file);
  }

  /**
   * Find the intent that produced a given content hash.
   */
  findByContentHash(contentHash: string): IntentRecord | null {
    return this.intents.list().find((r) => r.contentHash === contentHash) ?? null;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private buildSubtree(intent: IntentRecord, generation: number, seen: Set<string>): LineageNode[] {
    const nodes: LineageNode[] = [];

    for (const child of this.getChildren(intent.memoryId)) {
      if (seen.has(child.memoryId)) continue;
      seen.add(child.memoryId);
      nodes.push({
        intent: child,
        generation,
        children: this.buildSubtree(child, generation + 1, seen),
      });
    }

    return nodes;
  }

  private formatLineage(
    intent: IntentRecord,
    ancestors: IntentRecord[],
    descendants: LineageNode[],
  ): string {
    const lines: string[] = [
      '# Code Lineage',
      '',
      `- **File:** ${intent.file}`,
      `- **Generation:** ${ancestors.length}`,
      '',
    ];

    if (ancestors.length > 0) {
      lines.push('## Ancestors');
      ancestors.forEach((a, i) => {
        lines.push(`${i}. \`${a.memoryId}\` — ${a.prompt} (${a.contentHash})`);
      });
      lines.push('');
    }

    lines.push('## Current', `- \`${intent.memoryId}\` — ${intent.prompt} (${intent.contentHash})`, '');

    if (descendants.length > 0) {
      lines.push('## Descendants');
      const walk = (nodes: LineageNode[], indent: number): void => {
        for (const node of nodes) {
          lines.push(`${'  '.repeat(indent)}- \`${node.intent.memoryId}\` — ${node.intent.prompt}`);
          walk(node.children, indent + 1);
        }
      };
      walk(descendants, 0);
      lines.push('');
    }

    return lines.join('\n');
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
