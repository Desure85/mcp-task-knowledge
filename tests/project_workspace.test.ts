import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-workspace');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');
process.env.EMBEDDINGS_MODE = 'none';

let tasks: typeof import('../src/storage/tasks.js');
let knowledge: typeof import('../src/storage/knowledge.js');
let projects: typeof import('../src/projects.js');

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function uniqProj(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

beforeAll(async () => {
  await rmrf(TMP_DIR);
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  knowledge = await import('../src/storage/knowledge.js');
  projects = await import('../src/projects.js');
});

afterAll(async () => {
  await rmrf(TMP_DIR);
});

describe('project_create', () => {
  it('creates project with directories', async () => {
    const id = uniqProj('create');
    const project = await projects.createProject(id, 'Test project description');

    expect(project.id).toBe(id);
    expect(project.description).toBe('Test project description');
    expect(project.taskCount).toBe(0);
    expect(project.knowledgeCount).toBe(0);
    expect(project.createdAt).toBeDefined();

    // Verify directories exist
    const fs = await import('node:fs/promises');
    const stat1 = await fs.stat(project.paths.tasks);
    expect(stat1.isDirectory()).toBe(true);
    const stat2 = await fs.stat(project.paths.knowledge);
    expect(stat2.isDirectory()).toBe(true);
  });

  it('creates metadata file', async () => {
    const id = uniqProj('meta');
    await projects.createProject(id, 'With metadata');

    const meta = await projects.readProjectMetadata(id);
    expect(meta).not.toBeNull();
    expect(meta!.description).toBe('With metadata');
    expect(meta!.createdAt).toBeDefined();
  });

  it('creates project without description', async () => {
    const id = uniqProj('nodesc');
    const project = await projects.createProject(id);
    expect(project.description).toBeUndefined();
  });
});

describe('listProjects', () => {
  it('lists created projects with counts', async () => {
    const id = uniqProj('list');
    await projects.createProject(id);

    // Add some data
    await tasks.createTask({ project: id, title: 'T1', priority: 'medium' });
    await knowledge.createDoc({ project: id, title: 'D1', content: 'hello' });

    const result = await projects.listProjects(() => id);
    expect(result.count).toBeGreaterThanOrEqual(1);

    const found = result.projects.find(p => p.id === id);
    expect(found).toBeDefined();
    expect(found!.taskCount).toBe(1);
    expect(found!.knowledgeCount).toBe(1);
    expect(found!.isCurrent).toBe(true);
    expect(found!.hasTasks).toBe(true);
    expect(found!.hasKnowledge).toBe(true);
  });

  it('returns default project when no projects exist', async () => {
    const result = await projects.listProjects(() => 'mcp');
    expect(result.default).toBe('mcp');
    expect(result.count).toBeGreaterThanOrEqual(1);
  });
});

describe('getProjectDetail', () => {
  it('returns null for non-existent project', async () => {
    const detail = await projects.getProjectDetail('nonexistent-xyz', () => 'mcp');
    expect(detail).toBeNull();
  });

  it('returns full stats for existing project', async () => {
    const id = uniqProj('detail');
    await projects.createProject(id, 'Detailed project');

    // Add tasks with different statuses
    const t1 = await tasks.createTask({ project: id, title: 'T1', priority: 'high' });
    const t2 = await tasks.createTask({ project: id, title: 'T2', priority: 'low' });
    if (t1) await tasks.closeTask(id, t1.id);

    // Add knowledge
    await knowledge.createDoc({ project: id, title: 'Doc', content: 'test', type: 'api' });

    const detail = await projects.getProjectDetail(id, () => id);
    expect(detail).not.toBeNull();
    expect(detail!.taskStats.total).toBe(2);
    expect(detail!.taskStats.byStatus.closed).toBe(1);
    expect(detail!.taskStats.byStatus.pending).toBe(1);
    expect(detail!.taskStats.byPriority.high).toBe(1);
    expect(detail!.taskStats.recent.length).toBeGreaterThanOrEqual(1);
    expect(detail!.knowledgeStats.total).toBe(1);
    expect(detail!.knowledgeStats.byType.api).toBe(1);
    expect(detail!.description).toBe('Detailed project');
  });
});

describe('deleteProject', () => {
  it('rejects deleting default project', async () => {
    const result = await projects.deleteProject('mcp', false);
    expect(result.deleted).toBe(false);
    expect(result.message).toContain('Cannot delete');
  });

  it('rejects deleting non-empty project without force', async () => {
    const id = uniqProj('delfail');
    await projects.createProject(id);
    await tasks.createTask({ project: id, title: 'T1', priority: 'medium' });

    const result = await projects.deleteProject(id, false);
    expect(result.deleted).toBe(false);
    expect(result.message).toContain('has data');
  });

  it('deletes empty project', async () => {
    const id = uniqProj('delempty');
    await projects.createProject(id);

    const result = await projects.deleteProject(id, false);
    expect(result.deleted).toBe(true);
  });

  it('force-deletes project with data', async () => {
    const id = uniqProj('delforce');
    await projects.createProject(id);
    await tasks.createTask({ project: id, title: 'T1', priority: 'medium' });
    await knowledge.createDoc({ project: id, title: 'D1', content: 'hello' });

    const result = await projects.deleteProject(id, true);
    expect(result.deleted).toBe(true);

    // Verify project is gone
    const detail = await projects.getProjectDetail(id, () => 'mcp');
    expect(detail).toBeNull();
  });
});

describe('updateProjectMeta', () => {
  it('updates project description', async () => {
    const id = uniqProj('update');
    await projects.createProject(id, 'Original');

    const meta = await projects.updateProjectMeta(id, { description: 'Updated' });
    expect(meta).not.toBeNull();
    expect(meta!.description).toBe('Updated');
  });

  it('creates metadata for project without it', async () => {
    const id = uniqProj('newmeta');
    await projects.createProject(id); // no description

    const meta = await projects.updateProjectMeta(id, { description: 'New desc' });
    expect(meta!.description).toBe('New desc');
  });
});
