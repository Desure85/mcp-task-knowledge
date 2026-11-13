import { describe, expect, it } from 'vitest';
import { syncTasks, localFingerprint } from '../src/sync/engine.js';
import type { ExternalTask, SyncTaskStore, TrackerAdapter } from '../src/sync/types.js';
import type { Task } from '../src/types.js';

let tick = 0;
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();

class MemoryStore implements SyncTaskStore {
  tasks: Task[] = [];

  async list(project: string): Promise<Task[]> {
    return this.tasks.filter((task) => task.project === project).map((task) => ({ ...task }));
  }

  async create(input: Parameters<SyncTaskStore['create']>[0]): Promise<Task> {
    const task: Task = {
      id: `L${this.tasks.length + 1}`,
      project: input.project,
      title: input.title,
      description: input.description,
      status: input.status as Task['status'],
      priority: input.priority ?? 'medium',
      tags: input.tags,
      assignee: input.assignee,
      external: input.external,
      version: 1,
      createdAt: at(),
      updatedAt: at(),
    };
    this.tasks.push(task);
    return { ...task };
  }

  async update(project: string, id: string, patch: Partial<Task>): Promise<Task | null> {
    const task = this.tasks.find((candidate) => candidate.project === project && candidate.id === id);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: at() });
    return { ...task };
  }
}

class MemoryTracker implements TrackerAdapter {
  readonly system = 'file' as const;
  issues: ExternalTask[] = [];

  async list(): Promise<ExternalTask[]> {
    return this.issues.map((issue) => ({ ...issue }));
  }

  async create(input: ExternalTask): Promise<ExternalTask> {
    const issue = { ...input, id: `E${this.issues.length + 1}`, updatedAt: at() };
    this.issues.push(issue);
    return { ...issue };
  }

  async update(id: string, patch: Partial<Omit<ExternalTask, 'id' | 'updatedAt'>>): Promise<ExternalTask> {
    const issue = this.issues.find((candidate) => candidate.id === id);
    if (!issue) throw new Error('missing issue');
    Object.assign(issue, patch, { updatedAt: at() });
    return { ...issue };
  }
}

async function setup() {
  tick = 0;
  const store = new MemoryStore();
  const tracker = new MemoryTracker();
  tracker.issues.push({ id: 'E1', title: 'external one', status: 'pending', priority: 'medium', updatedAt: at() });
  const options = { project: 'p', store, adapter: tracker, dryRun: false };
  return { store, tracker, options };
}

describe('INT-008 two-way sync', () => {
  it('pulls a new external issue, then is idempotent', async () => {
    const { store, tracker, options } = await setup();
    const first = await syncTasks(options);
    expect(first.createdLocal).toHaveLength(1);
    expect(store.tasks[0].external?.id).toBe('E1');
    expect(store.tasks[0].external?.localHash).toBe(localFingerprint(store.tasks[0]));

    const second = await syncTasks(options);
    expect(second.createdLocal).toHaveLength(0);
    expect(second.updatedLocal).toHaveLength(0);
    expect(second.updatedExternal).toHaveLength(0);
    expect(tracker.issues).toHaveLength(1);
  });

  it('pushes a new local task once and does not duplicate it', async () => {
    const { store, tracker, options } = await setup();
    tracker.issues = [];
    await store.create({ project: 'p', title: 'local one', status: 'pending', priority: 'high' });

    const first = await syncTasks(options);
    expect(first.createdExternal).toHaveLength(1);
    expect(tracker.issues).toHaveLength(1);
    const second = await syncTasks(options);
    expect(second.createdExternal).toHaveLength(0);
    expect(tracker.issues).toHaveLength(1);
  });

  it('accepts an external edit when the local copy did not change', async () => {
    const { store, tracker, options } = await setup();
    await syncTasks(options);
    const issue = tracker.issues[0];
    issue.title = 'external renamed';
    issue.updatedAt = at();

    const result = await syncTasks(options);
    expect(result.updatedLocal).toHaveLength(1);
    expect(store.tasks[0].title).toBe('external renamed');
  });

  it('pushes a local edit when the external copy did not change', async () => {
    const { store, tracker, options } = await setup();
    await syncTasks(options);
    await store.update('p', store.tasks[0].id, { title: 'local renamed' });

    const result = await syncTasks(options);
    expect(result.updatedExternal).toHaveLength(1);
    expect(tracker.issues[0].title).toBe('local renamed');
  });

  it('lets the newer side win when both changed', async () => {
    const { store, tracker, options } = await setup();
    await syncTasks(options);
    await store.update('p', store.tasks[0].id, { title: 'local newer' });
    const issue = tracker.issues[0];
    issue.title = 'external older';
    issue.updatedAt = new Date(Date.parse(store.tasks[0].updatedAt) - 1000).toISOString();

    const result = await syncTasks(options);
    // local updatedAt was generated after the seeded external timestamp; local wins
    expect(result.conflicts).toHaveLength(0);
    expect(tracker.issues[0].title).toBe('local newer');
  });

  it('reports CONFLICT when both changed with equal timestamps and different fields', async () => {
    const { store, tracker, options } = await setup();
    await syncTasks(options);
    await store.update('p', store.tasks[0].id, { title: 'local same-time' });
    const issue = tracker.issues[0];
    issue.title = 'external same-time';
    issue.updatedAt = store.tasks[0].updatedAt;

    const result = await syncTasks(options);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fields).toContain('title');
    expect(store.tasks[0].title).toBe('local same-time');
  });

  it('dry-run reports work but performs no writes', async () => {
    const { store, tracker, options } = await setup();
    await syncTasks(options);
    tracker.issues[0].title = 'external dry';
    tracker.issues[0].updatedAt = at();
    const before = store.tasks.length;

    const result = await syncTasks({ ...options, dryRun: true });
    expect(result.updatedLocal).toHaveLength(1);
    expect(store.tasks.length).toBe(before);
  });
});
