import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-project-acl');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

let projects: typeof import('../src/projects.js');
let access: typeof import('../src/core/project-access.js');
let SecurityStack: typeof import('../src/core/security-stack.js').SecurityStack;
let tools: Map<string, Handler>;

async function call(handler: Handler, args: Record<string, unknown>) {
  const result = (await handler(args)) as { content?: Array<{ text?: string }> };
  return JSON.parse(result.content?.[0]?.text ?? '{}') as { ok: boolean; data?: any; error?: any };
}

function fakeAuth(userId: string, roles: string[] = ['user']) {
  return {
    isAuthRequired: () => true,
    getRoles: () => roles,
    getUserId: () => userId,
  } as never;
}

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  projects = await import('../src/projects.js');
  access = await import('../src/core/project-access.js');
  ({ SecurityStack } = await import('../src/core/security-stack.js'));
  const { registerProjectTools } = await import('../src/register/project.js');
  tools = new Map();
  registerProjectTools({
    server: {
      registerTool: (name: string, _def: unknown, handler: Handler) => tools.set(name, handler),
    },
    authManager: fakeAuth('admin', ['admin']),
  } as never);

  await projects.updateProjectMeta('alpha', {
    members: { alice: 'viewer', bob: 'editor', carol: 'admin' },
  });
  await projects.updateProjectMeta('legacy', { description: 'no members' });
  await projects.updateProjectMeta('foreign', { members: { mallory: 'viewer' } });
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

describe('T-02 project-level ACL', () => {
  it('romembership roles are enforced for read/write/admin tools', () => {
    const check = (toolName: string, userId: string, input: Record<string, unknown> = {}) =>
      access.checkProjectToolCall({
        toolName,
        input,
        userId,
        globalRoles: ['user'],
        open: false,
      });

    expect(check('tasks_list', 'alice', { project: 'alpha' })).toEqual({ allowed: true });
    expect(check('tasks_update', 'alice', { project: 'alpha' })).toMatchObject({ allowed: false });
    expect(check('tasks_update', 'bob', { project: 'alpha' })).toEqual({ allowed: true });
    expect(check('project_update', 'bob', { project: 'alpha' })).toMatchObject({ allowed: false });
    expect(check('project_update', 'carol', { project: 'alpha' })).toEqual({ allowed: true });
    expect(check('tasks_list', 'mallory', { project: 'alpha' })).toMatchObject({ allowed: false });
    // Legacy project without a members map stays open for compatibility.
    expect(check('tasks_update', 'mallory', { project: 'legacy' })).toEqual({ allowed: true });
    // Global admin bypasses membership.
    expect(access.checkProjectToolCall({
      toolName: 'project_update',
      input: { project: 'alpha' },
      userId: 'root',
      globalRoles: ['admin'],
      open: false,
    })).toEqual({ allowed: true });
  });

  it('SecurityStack denies viewer writes and foreign project reads', () => {
    const viewer = new SecurityStack({ authManager: fakeAuth('alice'), projectAccess: true });
    const editor = new SecurityStack({ authManager: fakeAuth('bob'), projectAccess: true });
    const stranger = new SecurityStack({ authManager: fakeAuth('mallory'), projectAccess: true });

    const write = viewer.check({ toolName: 'tasks_update', sessionId: 's', input: { project: 'alpha' } });
    expect(write).toMatchObject({ allowed: false, stage: 'project-acl' });

    expect(viewer.check({ toolName: 'tasks_list', sessionId: 's', input: { project: 'alpha' } }).allowed).toBe(true);
    expect(editor.check({ toolName: 'tasks_update', sessionId: 's', input: { project: 'alpha' } }).allowed).toBe(true);
    expect(stranger.check({ toolName: 'tasks_list', sessionId: 's', input: { project: 'alpha' } }))
      .toMatchObject({ allowed: false, stage: 'project-acl' });
  });

  it('project_list only shows legacy projects and explicit memberships', () => {
    const visible = access.filterVisibleProjects(
      [{ id: 'alpha' }, { id: 'legacy' }, { id: 'foreign' }],
      { userId: 'alice', globalRoles: ['user'], open: false },
    );
    expect(visible.map((p) => p.id)).toEqual(['alpha', 'legacy']);

    const admin = access.filterVisibleProjects(
      [{ id: 'alpha' }, { id: 'legacy' }],
      { userId: 'root', globalRoles: ['admin'], open: false },
    );
    expect(admin.map((p) => p.id)).toEqual(['alpha', 'legacy']);
  });

  it('project_members_set/list/remove persist members', async () => {
    const set = await call(tools.get('project_members_set')!, { project: 'legacy', userId: 'dave', role: 'editor' });
    expect(set.ok).toBe(true);
    expect(set.data.members).toEqual({ dave: 'editor' });

    const list = await call(tools.get('project_members_list')!, { project: 'legacy' });
    expect(list.ok).toBe(true);
    expect(list.data.members).toEqual({ dave: 'editor' });

    const removed = await call(tools.get('project_members_remove')!, { project: 'legacy', userId: 'dave' });
    expect(removed.ok).toBe(true);
    expect(removed.data.members).toEqual({});
    expect(access.readProjectMembersSync('legacy')).toEqual({});
  });
});
