import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function importFresh<T = any>(specifier: string): Promise<T> {
  vi.resetModules();
  const m = await import(specifier);
  return m as any;
}

const ENV_SNAPSHOT = { ...process.env } as Record<string, string | undefined>;

beforeEach(() => {
  process.env = { ...ENV_SNAPSHOT } as any;
});

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT } as any;
});

describe('project_list tool and listProjects()', () => {
  it('returns at least the default project when no dirs exist', async () => {
    process.env.DATA_DIR = '/tmp/mcp-data';
    process.env.OBSIDIAN_VAULT_ROOT = '/data/obsidian';

    const { listProjects } = await importFresh<any>('../projects.ts');
    const { getCurrentProject } = await importFresh<any>('../config.ts');

    const res = await listProjects(getCurrentProject);
    expect(res.count).toBeGreaterThanOrEqual(1);
    const ids = res.projects.map((p: any) => p.id);
    expect(ids).toContain('mcp');
    const mcpInfo = res.projects.find((p: any) => p.id === 'mcp');
    expect(mcpInfo?.isDefault).toBe(true);
  });

  it('detects a project from tasks/ and knowledge/ subfolders', async () => {
    // Arrange env so TASKS_DIR/KNOWLEDGE_DIR resolve under /tmp
    process.env.DATA_DIR = '/tmp/mcp-data';
    process.env.OBSIDIAN_VAULT_ROOT = '/data/obsidian';

    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Re-import config to compute TASKS_DIR/KNOWLEDGE_DIR from env
    const cfgMod = await importFresh<any>('../config.ts');

    // Create a synthetic project "foo"
    await fs.mkdir(path.join(cfgMod.TASKS_DIR, 'foo'), { recursive: true });
    await fs.mkdir(path.join(cfgMod.KNOWLEDGE_DIR, 'foo'), { recursive: true });

    const { listProjects } = await importFresh<any>('../projects.ts');
    const res = await listProjects(cfgMod.getCurrentProject);

    const ids = res.projects.map((p: any) => p.id);
    expect(ids).toContain('foo');
    const foo = res.projects.find((p: any) => p.id === 'foo');
    expect(foo?.hasTasks).toBe(true);
    expect(foo?.hasKnowledge).toBe(true);

    // Cleanup dirs (best-effort)
    await fs.rm(path.join(cfgMod.TASKS_DIR, 'foo'), { recursive: true, force: true });
    await fs.rm(path.join(cfgMod.KNOWLEDGE_DIR, 'foo'), { recursive: true, force: true });
  });
});
