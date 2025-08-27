import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-knowledge-structure');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}

// Replicate sanitize logic used in export.ts for assertions
const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|]/g, '_').trim() || 'untitled';

describe('obsidian export: knowledge structure, sanitize and structuralOnly frontmatter', () => {
  let exp: any; let kb: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    // Env before dynamic imports
    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    kb = await import('../src/storage/knowledge.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('creates type folders, sanitizes names, writes INDEX.md for structural nodes and omits structuralOnly on selected leaf', async () => {
    // Parent (overview) with special chars in title (to test sanitize)
    const parentTitle = 'P:/\\:*?"<>|';
    const kParent = await kb.createDoc({ project: PROJECT, title: parentTitle, content: 'parent content', tags: ['root'], type: 'overview' });

    // Selected child (component) under parent
    const childTitle = 'C:leaf';
    const kChild = await kb.createDoc({ project: PROJECT, title: childTitle, content: 'child content', tags: ['x'], parentId: kParent.id, type: 'component' });

    // Another doc that should NOT be exported (not matching includeTags)
    await kb.createDoc({ project: PROJECT, title: 'OTHER', content: 'other', tags: ['y'], type: 'api' });

    // Also archived doc should be excluded by default
    const kArch = await kb.createDoc({ project: PROJECT, title: 'ARCH', content: 'arch', tags: ['x'], type: 'overview' });
    await kb.archiveDoc(PROJECT, kArch.id);

    const opts = {
      knowledge: true,
      tasks: false,
      includeTags: ['x'], // selects only the child; parent included structurally via closure
      keepOrphans: false,
      strategy: 'replace' as const,
    };

    const er = await exp.exportProjectToVault(PROJECT, opts);
    expect(er.vaultRoot).toBe(VAULT);
    expect(er.knowledgeCount).toBeGreaterThan(0);

    const projRoot = path.join(VAULT, PROJECT);
    const kDir = path.join(projRoot, 'Knowledge');

    // Parent (overview) should be a folder with INDEX.md, under type folder "Overview"
    const parentDir = path.join(kDir, 'Overview', sanitize(parentTitle));
    const parentIndex = path.join(parentDir, 'INDEX.md');
    expect(await exists(parentDir)).toBe(true);
    expect(await exists(parentIndex)).toBe(true);

    // Child (component) should be a single .md file under type folder "Components" inside parent's folder
    const childFile = path.join(kDir, 'Components', sanitize(parentTitle), `${sanitize(childTitle)}.md`);
    expect(await exists(childFile)).toBe(true);

    // Ensure child is NOT written under parent's type folder (Overview)
    const wrongChildPath = path.join(kDir, 'Overview', sanitize(parentTitle), `${sanitize(childTitle)}.md`);
    expect(await exists(wrongChildPath)).toBe(false);

    // Read files to check frontmatter/body
    const parentBody = await fsp.readFile(parentIndex, 'utf8');
    const childBody = await fsp.readFile(childFile, 'utf8');

    // Parent is structural-only (not directly selected) => has structuralOnly: true and no original content
    expect(parentBody).toContain('structuralOnly: true');
    expect(parentBody).not.toContain('parent content');

    // Child is selected leaf => no structuralOnly key, content present
    expect(childBody).not.toContain('structuralOnly:');
    expect(childBody).toContain('child content');

    // Ensure archived doc wasn't exported by default (includeArchived not set)
    const archDir = path.join(kDir, 'Overview', 'ARCH');
    expect(await exists(archDir)).toBe(false);
  }, 30000);
});
