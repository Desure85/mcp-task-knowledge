import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Contract: CLI must expose only bulk/list/tree/get for tasks/knowledge (no single-tools)
// We assert by parsing src/index.ts for server.registerTool("...") occurrences.

describe('CLI tools contract — no single-tools registered', () => {
  it('does not register banned single-tools', () => {
    const ROOT = process.cwd();
    const SRC = path.join(ROOT, 'src', 'index.ts');
    const src = fs.readFileSync(SRC, 'utf-8');

    const re = /registerTool\(\s*["'`]([^"'`]+)["'`]/g;
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      names.add(m[1]);
    }

    // Explicit banned names for single-tools we removed during CLI refactor
    const banned = [
      'tasks_create',
      'tasks_update',
      'tasks_archive',
      'tasks_trash',
      'tasks_restore',
      'tasks_close',
      'tasks_delete_permanent',
      'knowledge_create',
      'knowledge_update',
      'knowledge_archive',
      'knowledge_trash',
      'knowledge_restore',
      'knowledge_delete_permanent',
    ];

    const foundBanned = banned.filter((b) => names.has(b));
    if (foundBanned.length > 0) {
      // Provide helpful diff in failure
      console.error('Registered tools:', Array.from(names).sort());
    }
    expect(foundBanned, `banned single-tools present: ${foundBanned.join(', ')}`).toEqual([]);
  });
});
