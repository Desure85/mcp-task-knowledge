import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

// TMP envs must be set before dynamic imports
const TMP_DIR = path.join(process.cwd(), '.tmp-tests-tasks-delete-tool');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

// Dynamic imports after env
import type * as TasksNS from '../src/storage/tasks.js';
import type * as Helpers from '../src/tools/tasks_delete_helpers.js';
let tasks!: typeof TasksNS;
let helpers!: typeof Helpers;

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  helpers = await import('../src/tools/tasks_delete_helpers.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('tasks_delete helpers: confirm/dryRun', () => {
  it('confirm=false -> error, без изменений', async () => {
    const project = 'mcp';
    const t = await tasks.createTask({ project, title: 'NoDelete', priority: 'medium' });

    const res = await helpers.handleTaskDelete({ project, id: t.id, confirm: false });
    expect(res.ok).toBe(false);
    expect((res as any).error?.message).toContain('not confirmed');

    const after = await tasks.getTask(project, t.id);
    expect(after).not.toBeUndefined();
  });

  it('dryRun=true -> ok, возвращает метаданные, без удаления', async () => {
    const project = 'mcp';
    const t = await tasks.createTask({ project, title: 'DryRun', priority: 'low' });

    const res = await helpers.handleTaskDelete({ project, id: t.id, dryRun: true });
    expect(res.ok).toBe(true);
    expect((res as any).data?.id).toBe(t.id);

    const after = await tasks.getTask(project, t.id);
    expect(after).not.toBeUndefined();
  });
});
