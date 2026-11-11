import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-task-evidence');
process.env.DATA_DIR = TMP_DIR;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP_DIR, 'vault');

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

let tasks: typeof import('../src/storage/tasks.js');
let projects: typeof import('../src/projects.js');
let tools: Map<string, Handler>;

async function call(handler: Handler, args: Record<string, unknown>) {
  const result = (await handler(args)) as { content?: Array<{ text?: string }>; isError?: boolean };
  return JSON.parse(result.content?.[0]?.text ?? '{}') as { ok: boolean; data?: any; error?: any };
}

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  tasks = await import('../src/storage/tasks.js');
  projects = await import('../src/projects.js');
  const { registerTasksTools } = await import('../src/register/tasks.js');
  tools = new Map();
  registerTasksTools({
    server: {
      registerTool: (name: string, _def: unknown, handler: Handler) => tools.set(name, handler),
    },
  } as never);
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

describe('U-03 evidence when closing a task', () => {
  it('requires evidence when the project sets requireEvidence', async () => {
    const project = 'evidence-project';
    const task = await tasks.createTask({ project, title: 'Close me' });
    await projects.updateProjectMeta(project, { requireEvidence: true });

    const closed = await call(tools.get('tasks_close')!, { project, id: task.id });
    expect(closed.ok).toBe(false);
    expect(closed.error.code).toBe('EVIDENCE_REQUIRED');
    expect(closed.error.hint).toContain('commitSha');
    expect((await tasks.getTask(project, task.id))?.status).not.toBe('done');
  });

  it('rejects malformed evidence and stores valid evidence visibly', async () => {
    const project = 'evidence-project';
    const task = await tasks.createTask({ project, title: 'With evidence' });
    await projects.updateProjectMeta(project, { requireEvidence: true });

    const badSha = await call(tools.get('tasks_close')!, {
      project,
      id: task.id,
      evidence: { commitSha: 'NOPE' },
    });
    expect(badSha.ok).toBe(false);
    expect(badSha.error.code).toBe('EVIDENCE_INVALID');

    const httpUrl = await call(tools.get('tasks_close')!, {
      project,
      id: task.id,
      evidence: { ciUrl: 'http://ci.example/run/1' },
    });
    expect(httpUrl.ok).toBe(false);
    expect(httpUrl.error.code).toBe('EVIDENCE_INVALID');

    const tooLong = await call(tools.get('tasks_close')!, {
      project,
      id: task.id,
      evidence: { checkOutput: 'x'.repeat(4097) },
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.error.code).toBe('EVIDENCE_INVALID');

    const sha = 'abcdef1';
    const closed = await call(tools.get('tasks_close')!, {
      project,
      id: task.id,
      evidence: { commitSha: sha, ciUrl: 'https://ci.example/run/1', note: 'green' },
    });
    expect(closed.ok).toBe(true);
    expect(closed.data.closed.evidence.commitSha).toBe(sha);
    expect(closed.data.closed.evidence.ciUrl).toBe('https://ci.example/run/1');
    expect(typeof closed.data.closed.evidence.at).toBe('string');

    const fetched = await call(tools.get('tasks_get')!, { project, id: task.id });
    expect(fetched.ok).toBe(true);
    expect(fetched.data.evidence.commitSha).toBe(sha);
    expect(fetched.data.evidence.note).toBe('green');
  });

  it('allows closing without evidence when requireEvidence is off', async () => {
    const project = 'no-evidence-project';
    const task = await tasks.createTask({ project, title: 'No evidence needed' });
    await projects.updateProjectMeta(project, { requireEvidence: false });

    const closed = await call(tools.get('tasks_close')!, { project, id: task.id });
    expect(closed.ok).toBe(true);
    expect(closed.data.closed.evidence).toBeUndefined();
  });
});
