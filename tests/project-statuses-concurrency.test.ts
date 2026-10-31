import { describe, it, expect } from 'vitest';
import { createProject, deleteProject } from '../src/projects.js';
import { createTask, getTask, updateTask } from '../src/storage/tasks.js';
import { setProjectStatuses } from '../src/workflow-service.js';

function projectName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const BASE = [
  { id: 'todo', label: 'Todo', category: 'todo' as const, color: 'st-todo', order: 0 },
  { id: 'doing', label: 'Doing', category: 'in_progress' as const, color: 'st-doing', order: 1 },
  { id: 'done', label: 'Done', category: 'done' as const, color: 'st-done', order: 2 },
];

describe('project status set vs task update race', () => {
  it('never leaves a task in a removed status', async () => {
    const project = projectName('v01-race');
    await createProject(project);
    await setProjectStatuses(project, {
      statuses: BASE,
      initialStatuses: ['todo'],
      closeStatus: 'done',
    });
    const task = await createTask({ project, title: 'racing task' });

    const results = await Promise.allSettled([
      setProjectStatuses(project, {
        statuses: BASE.filter((status) => status.id !== 'doing'),
        moveTo: 'todo',
      }),
      updateTask(project, task.id, { status: 'doing' }),
    ]);

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const final = await getTask(project, task.id);
    expect(final).not.toBeNull();
    expect(final!.status).toBe('todo');

    const { loadProjectWorkflow } = await import('../src/workflow.js');
    const workflow = await loadProjectWorkflow(project);
    expect(workflow.statuses.map((status) => status.id)).toEqual(['todo', 'done']);
    await deleteProject(project, true);
  });
});
