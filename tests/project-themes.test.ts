import { describe, expect, it } from 'vitest';
import { createProject, deleteProject, readProjectMetadata, updateProjectMeta } from '../src/projects.js';
import { checkProjectToolCall } from '../src/core/project-access.js';

const theme = { id: 'team-blue', name: 'Team blue', theme: { base: { primary: '#2563eb' } }, updatedAt: '2026-11-12T00:00:00.000Z' };

describe('UI-33b project themes (server)', () => {
  it('stores team themes in project data and lists them', async () => {
    const id = 'ui33b-' + Date.now();
    await createProject(id);
    try {
      await updateProjectMeta(id, { themes: [theme] });
      expect((await readProjectMetadata(id))?.themes).toEqual([theme]);
      await updateProjectMeta(id, { themes: [] });
      expect((await readProjectMetadata(id))?.themes).toEqual([]);
    } finally {
      await deleteProject(id, true);
    }
  });

  it('lets editors/admin publish but rejects viewers and non-members', async () => {
    const id = 'ui33b-acl-' + Date.now();
    await createProject(id);
    try {
      await updateProjectMeta(id, { members: { editor1: 'editor', admin1: 'admin', viewer1: 'viewer' } });
      const call = (userId: string) => checkProjectToolCall({ toolName: 'project_theme_set', input: { project: id }, userId, globalRoles: [], open: false });
      expect(call('editor1')).toMatchObject({ allowed: true });
      expect(call('admin1')).toMatchObject({ allowed: true });
      expect(call('viewer1')).toMatchObject({ allowed: false });
      expect(call('nobody')).toMatchObject({ allowed: false });
    } finally { await deleteProject(id, true); }
  });

  it('classifies theme writes as writes and theme list as a read', () => {
    const ctx = { userId: 'u', globalRoles: [] as string[], open: true };
    expect(checkProjectToolCall({ ...ctx, toolName: 'project_theme_set', input: {} }).allowed).toBe(true);
    expect(checkProjectToolCall({ ...ctx, toolName: 'project_themes_list', input: {} }).allowed).toBe(true);
  });
});

