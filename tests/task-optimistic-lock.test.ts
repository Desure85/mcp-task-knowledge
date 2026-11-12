import { describe, expect, it } from 'vitest';
import { createTask, deleteTaskPermanent, updateTask } from '../src/storage/tasks.js';
import { WorkflowError } from '../src/workflow.js';
import { createDoc, deleteDocPermanent, updateDoc } from '../src/storage/knowledge.js';

describe('MU-02 task optimistic locking', () => {
  it('bumps version, merges different fields, conflicts on stale same field', async () => {
    const project = `mu02-${Date.now()}`;
    const task = await createTask({ project, title: 'initial', priority: 'medium' });
    try {
      expect(task.version).toBe(1);

      const title1 = await updateTask(project, task.id, { title: 'one' }, 1);
      expect(title1?.version).toBe(2);
      expect(title1?.fieldVersions?.title).toBe(2);

      // Stale snapshot, but a different field: merge is allowed.
      const priority = await updateTask(project, task.id, { priority: 'high' }, 1);
      expect(priority?.version).toBe(3);
      expect(priority?.title).toBe('one');
      expect(priority?.fieldVersions?.priority).toBe(3);
      expect(priority?.fieldVersions?.title).toBe(2);

      // Stale snapshot and the same field: CONFLICT, no write.
      await expect(updateTask(project, task.id, { title: 'stale' }, 1)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: {
          expectedVersion: 1,
          currentVersion: 3,
          fields: ['title'],
        },
      });
      expect((await updateTask(project, task.id, { title: 'unused' }, 3))?.title).toBe('unused');
    } finally {
      await deleteTaskPermanent(project, task.id);
    }
  });

  it('does not let expectedVersion from the future write', async () => {
    const project = `mu02-future-${Date.now()}`;
    const task = await createTask({ project, title: 'future' });
    try {
      await expect(updateTask(project, task.id, { title: 'nope' }, 99)).rejects.toBeInstanceOf(WorkflowError);
    } finally {
      await deleteTaskPermanent(project, task.id);
    }
  });
});
describe('MU-02 document optimistic locking', () => {
  it('conflicts only on fields changed after the expected version', async () => {
    const project = `mu02-doc-${Date.now()}`;
    const doc = await createDoc({ project, title: 'doc', content: 'one' });
    try {
      expect(doc.version).toBe(1);
      const content = await updateDoc(project, doc.id, { content: 'two' }, 1);
      expect(content?.version).toBe(2);
      const tags = await updateDoc(project, doc.id, { tags: ['x'] }, 1);
      expect(tags?.version).toBe(3);
      expect(tags?.content).toBe('two');
      await expect(updateDoc(project, doc.id, { content: 'stale' }, 1)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { fields: ['content'], expectedVersion: 1, currentVersion: 3 },
      });
      expect((await updateDoc(project, doc.id, { content: 'three' }, 3))?.version).toBe(4);
    } finally {
      await deleteDocPermanent(project, doc.id);
    }
  });
});