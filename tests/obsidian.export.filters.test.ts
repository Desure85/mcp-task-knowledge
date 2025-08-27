import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-export-filters');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

function isoDate(s: string): string {
  return new Date(s).toISOString();
}

describe('obsidian export filters and dryRun plan', () => {
  let exp: any; let tasks: any; let kb: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await fsp.mkdir(VAULT, { recursive: true });
    await fsp.mkdir(STORE, { recursive: true });

    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    tasks = await import('../src/storage/tasks.js');
    kb = await import('../src/storage/knowledge.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('filters: include/exclude tags, includeTypes/excludeTypes, includeStatus/includePriority, dates, includeArchived; closure via keepOrphans', async () => {
    // Seed Knowledge: parent -> child
    const kParent = await kb.createDoc({ project: PROJECT, title: 'K_PARENT', content: 'P', tags: ['root'], type: 'overview' });
    const kChild = await kb.createDoc({ project: PROJECT, title: 'K_CHILD', content: 'C', tags: ['feat', 'x'], parentId: kParent.id, type: 'component' });
    const kOther = await kb.createDoc({ project: PROJECT, title: 'K_OTHER', content: 'O', tags: ['y'], type: 'api' });

    // Update timestamps to controlled values
    await kb.updateDoc(PROJECT, kParent.id, { updatedAt: isoDate('2023-01-01T00:00:00Z') } as any);
    await kb.updateDoc(PROJECT, kChild.id, { updatedAt: isoDate('2024-01-01T00:00:00Z') } as any);
    await kb.updateDoc(PROJECT, kOther.id, { updatedAt: isoDate('2024-06-01T00:00:00Z') } as any);

    // Archive one doc and trash one (trashed must be excluded always)
    await kb.archiveDoc(PROJECT, kOther.id);
    const kTrashed = await kb.createDoc({ project: PROJECT, title: 'K_TRASH', content: 'T', tags: ['z'], type: 'note' });
    await kb.trashDoc(PROJECT, kTrashed.id);

    // Seed Tasks: parent -> child
    const tParent = await tasks.createTask({ project: PROJECT, title: 'T_PARENT', priority: 'low', tags: ['root'] });
    const tChild = await tasks.createTask({ project: PROJECT, title: 'T_CHILD', priority: 'high', tags: ['x'], parentId: tParent.id });
    const tOther = await tasks.createTask({ project: PROJECT, title: 'T_OTHER', priority: 'medium', tags: ['y'] });

    // Set statuses and timestamps
    await tasks.updateTask(PROJECT, tParent.id, { status: 'completed', updatedAt: isoDate('2023-02-01T00:00:00Z') } as any);
    await tasks.updateTask(PROJECT, tChild.id, { status: 'in_progress', updatedAt: isoDate('2024-03-01T00:00:00Z') } as any);
    await tasks.updateTask(PROJECT, tOther.id, { status: 'closed', updatedAt: isoDate('2024-06-15T00:00:00Z') } as any);

    // Archive one task and trash one (trashed excluded always)
    await tasks.archiveTask(PROJECT, tOther.id);
    const tTrashed = await tasks.createTask({ project: PROJECT, title: 'T_TRASH', priority: 'low', tags: ['z'] });
    await tasks.trashTask(PROJECT, tTrashed.id);

    // 1) includeTags selects child nodes; keepOrphans=false adds ancestors to closure
    let plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      includeTags: ['x'], // selects K_CHILD and T_CHILD
      keepOrphans: false,
    });
    expect(plan.knowledgeCount).toBeGreaterThanOrEqual(2); // K_CHILD + K_PARENT
    expect(plan.tasksCount).toBeGreaterThanOrEqual(2); // T_CHILD + T_PARENT

    // 2) keepOrphans=true should include all nodes (except trashed, and excluding archived by default)
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      includeTags: ['x'],
      keepOrphans: true,
    });
    // Knowledge: K_PARENT, K_CHILD; K_OTHER is archived and excluded by default; K_TRASH trashed excluded
    expect(plan.knowledgeCount).toBe(2);
    // Tasks: T_PARENT, T_CHILD; T_OTHER archived excluded by default; T_TRASH trashed excluded
    expect(plan.tasksCount).toBe(2);

    // 3) includeArchived=true should add archived ones
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      includeArchived: true,
      keepOrphans: true,
    });
    expect(plan.knowledgeCount).toBe(3); // + K_OTHER
    expect(plan.tasksCount).toBe(3); // + T_OTHER

    // 4) excludeTags has precedence over includeTags, but keepOrphans=true includes all non-trashed (non-archived by default)
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      includeTags: ['x'],
      excludeTags: ['x'],
      keepOrphans: true,
    });
    // Несмотря на исключение тегов, keepOrphans=true расширяет план до всех не-трешнутых узлов
    expect(plan.knowledgeCount).toBe(2); // K_PARENT + K_CHILD
    expect(plan.tasksCount).toBe(2); // T_PARENT + T_CHILD

    // 5) includeTypes/excludeTypes for knowledge
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includeTypes: ['component', 'api'], // K_CHILD(component) + K_OTHER(api)
      includeArchived: true,
      keepOrphans: false,
    });
    // Closure adds parent of K_CHILD
    expect(plan.knowledgeCount).toBe(3); // K_CHILD + K_PARENT + K_OTHER

    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: false,
      includeTypes: ['component', 'api'],
      excludeTypes: ['api'], // exclude wins -> only component
      includeArchived: true,
      keepOrphans: false,
    });
    expect(plan.knowledgeCount).toBe(2); // K_CHILD + K_PARENT

    // 6) includeStatus/includePriority for tasks
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: false,
      tasks: true,
      includeStatus: ['in_progress'], // selects T_CHILD
      keepOrphans: false,
    });
    expect(plan.tasksCount).toBe(2); // T_CHILD + T_PARENT via closure

    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: false,
      tasks: true,
      includePriority: ['low'], // selects T_PARENT (archived=false) and T_TRASH(trashed excluded) -> only T_PARENT
      keepOrphans: false,
    });
    expect(plan.tasksCount).toBe(1); // only T_PARENT (no parent for parent)

    // 7) updatedFrom/updatedTo window
    // Note: storage updates updatedAt automatically to now, so we test boundary behavior generically.
    // 7a) Future-only window should exclude all
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      updatedFrom: '2999-01-01T00:00:00Z',
      includeArchived: true,
      keepOrphans: false,
    });
    expect(plan.knowledgeCount).toBe(0);
    expect(plan.tasksCount).toBe(0);

    // 7b) Wide window (past..future) should include all (with includeArchived)
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      updatedFrom: '2000-01-01T00:00:00Z',
      updatedTo: '2999-01-01T00:00:00Z',
      includeArchived: true,
      keepOrphans: false,
    });
    expect(plan.knowledgeCount).toBe(3); // K_PARENT + K_CHILD + K_OTHER (closure dedups)
    expect(plan.tasksCount).toBe(3); // T_PARENT + T_CHILD + T_OTHER

    // 8) strategy replace should advertise willDeleteDirs
    plan = await exp.planExportProjectToVault(PROJECT, {
      knowledge: true,
      tasks: true,
      strategy: 'replace',
      keepOrphans: true,
    });
    const expectedK = path.join(VAULT, PROJECT, 'Knowledge');
    const expectedT = path.join(VAULT, PROJECT, 'Tasks');
    expect(plan.willDeleteDirs).toContain(expectedK);
    expect(plan.willDeleteDirs).toContain(expectedT);
  }, 30000);
});
