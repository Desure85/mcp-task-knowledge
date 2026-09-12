/**
 * DX-17 — `doctor --data` integrity scan of DATA_DIR.
 *
 * Tests the scanner (scanDataDir) and argv parsing (runDoctorCli) directly
 * against a fixture DATA_DIR in a tmp dir — no server context needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import matter from 'gray-matter';
import {
  scanDataDir,
  runDoctorCli,
  formatReport,
  type DoctorPaths,
} from '../src/cli/doctor.js';

let ROOT: string;
let PATHS: DoctorPaths;

async function write(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf-8');
}

function taskJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'task-1',
    project: 'acme',
    title: 'T',
    status: 'pending',
    priority: 'medium',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

function docMd(fm: Record<string, unknown> = {}, body = 'hello') {
  const meta: Record<string, unknown> = { id: 'doc-1', project: 'acme', title: 'D', createdAt: 'x', updatedAt: 'x', ...fm };
  for (const k of Object.keys(meta)) if (meta[k] === undefined) delete meta[k];
  return matter.stringify(body, meta);
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'doctor-test-'));
  PATHS = {
    dataDir: ROOT,
    tasksDir: path.join(ROOT, 'tasks'),
    knowledgeDir: path.join(ROOT, 'knowledge'),
    projectsMetaDir: path.join(ROOT, 'projects'),
  };
});

afterEach(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

describe('scanDataDir — clean tree', () => {
  it('reports zero issues on a healthy layout', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson());
    await write(path.join(PATHS.knowledgeDir, 'acme', 'doc-1.md'), docMd());
    await write(path.join(PATHS.projectsMetaDir, 'acme.json'), JSON.stringify({ id: 'acme', createdAt: 'x', updatedAt: 'x' }));

    const r = await scanDataDir(PATHS);
    expect(r.errors).toBe(0);
    expect(r.warnings).toBe(0);
    expect(r.scanned).toEqual({ json: 1, md: 1 });
  });

  it('handles missing dirs gracefully', async () => {
    const r = await scanDataDir(PATHS);
    expect(r.errors).toBe(0);
    expect(r.scanned).toEqual({ json: 0, md: 0 });
  });
});

describe('scanDataDir — corrupt JSON', () => {
  it('flags unparseable task JSON', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'bad.json'), '{not json');
    const r = await scanDataDir(PATHS);
    expect(r.errors).toBe(1);
    expect(r.issues[0].check).toBe('corrupt-json');
  });

  it('flags non-object JSON', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'arr.json'), '[1,2,3]');
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'corrupt-json')).toBe(true);
  });

  it('flags corrupt project metadata', async () => {
    await write(path.join(PATHS.projectsMetaDir, 'acme.json'), '{{{');
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'corrupt-json' && i.file.includes('projects'))).toBe(true);
  });
});

describe('scanDataDir — task fields', () => {
  it('flags missing required fields', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson({ title: '', status: undefined }));
    const r = await scanDataDir(PATHS);
    const missing = r.issues.filter((i) => i.check === 'missing-field');
    expect(missing.length).toBe(2);
    expect(r.errors).toBe(2);
  });

  it('flags id ≠ filename', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'file-name.json'), taskJson({ id: 'different-id' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'id-mismatch')).toBe(true);
  });

  it('flags project ≠ dir', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson({ project: 'other' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'project-mismatch')).toBe(true);
  });

  it('warns on invalid project id charset', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson({ project: 'bad proj!' }));
    const r = await scanDataDir(PATHS);
    // project-mismatch (dir=acme) + invalid-project-id
    expect(r.issues.some((i) => i.check === 'invalid-project-id')).toBe(true);
  });

  it('warns on unknown status/priority', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson({ status: 'weird', priority: 'urgent' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'invalid-status')).toBe(true);
    expect(r.issues.some((i) => i.check === 'invalid-priority')).toBe(true);
  });

  it('scans legacy flat layout (no project dir)', async () => {
    await write(path.join(PATHS.tasksDir, 'legacy-1.json'), taskJson({ id: 'legacy-1', project: 'acme' }));
    const r = await scanDataDir(PATHS);
    // flat file: project field is authoritative, no project-mismatch
    expect(r.issues.filter((i) => i.check === 'project-mismatch')).toHaveLength(0);
    expect(r.scanned.json).toBe(1);
  });
});

describe('scanDataDir — knowledge', () => {
  it('flags unparseable frontmatter', async () => {
    await write(path.join(PATHS.knowledgeDir, 'acme', 'bad.md'), '---\n[unclosed\n---\nbody');
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'bad-frontmatter')).toBe(true);
  });

  it('flags missing id in frontmatter', async () => {
    await write(path.join(PATHS.knowledgeDir, 'acme', 'doc-1.md'), docMd({ id: undefined }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'missing-field' && i.detail.includes('id'))).toBe(true);
  });

  it('flags missing project in frontmatter', async () => {
    await write(path.join(PATHS.knowledgeDir, 'acme', 'doc-1.md'), docMd({ project: undefined }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'missing-field' && i.detail.includes('project'))).toBe(true);
  });

  it('warns on orphan doc at knowledge root', async () => {
    await write(path.join(PATHS.knowledgeDir, 'orphan.md'), docMd({ project: undefined }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'knowledge-orphan')).toBe(true);
  });

  it('warns on project mismatch between fm and dir', async () => {
    await write(path.join(PATHS.knowledgeDir, 'acme', 'doc-1.md'), docMd({ project: 'other' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'project-mismatch')).toBe(true);
  });
});

describe('scanDataDir — projects cross-check', () => {
  it('warns when project dir has no metadata', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'task-1.json'), taskJson());
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'project-no-metadata' && i.file === 'acme')).toBe(true);
  });

  it('warns when metadata has no dirs', async () => {
    await write(path.join(PATHS.projectsMetaDir, 'ghost.json'), JSON.stringify({ id: 'ghost' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'project-no-data')).toBe(true);
  });

  it('flags metadata id ≠ filename', async () => {
    await write(path.join(PATHS.projectsMetaDir, 'acme.json'), JSON.stringify({ id: 'other' }));
    const r = await scanDataDir(PATHS);
    expect(r.issues.some((i) => i.check === 'id-mismatch')).toBe(true);
  });
});

describe('scanDataDir — --fix', () => {
  it('fills derivable task id and project', async () => {
    const p = path.join(PATHS.tasksDir, 'acme', 'task-9.json');
    await write(p, taskJson({ id: undefined, project: undefined }));
    const r = await scanDataDir(PATHS, { fix: true });
    expect(r.fixed).toBe(2);
    const after = JSON.parse(await fsp.readFile(p, 'utf-8'));
    expect(after.id).toBe('task-9');
    expect(after.project).toBe('acme');
  });

  it('fills derivable knowledge id and project', async () => {
    const p = path.join(PATHS.knowledgeDir, 'acme', 'doc-9.md');
    await write(p, docMd({ id: undefined, project: undefined }));
    const r = await scanDataDir(PATHS, { fix: true });
    expect(r.fixed).toBe(2);
    const fm = matter(await fsp.readFile(p, 'utf-8'));
    expect(fm.data.id).toBe('doc-9');
    expect(fm.data.project).toBe('acme');
  });

  it('never fixes corrupt JSON', async () => {
    const p = path.join(PATHS.tasksDir, 'acme', 'bad.json');
    await write(p, '{broken');
    const r = await scanDataDir(PATHS, { fix: true });
    expect(r.errors).toBe(1);
    expect(await fsp.readFile(p, 'utf-8')).toBe('{broken');
  });

  it('is idempotent — second run finds nothing to fix', async () => {
    const p = path.join(PATHS.tasksDir, 'acme', 'task-9.json');
    await write(p, taskJson({ id: undefined, project: undefined }));
    await scanDataDir(PATHS, { fix: true });
    const r2 = await scanDataDir(PATHS, { fix: true });
    expect(r2.fixed).toBe(0);
    expect(r2.errors).toBe(0);
  });
});

describe('runDoctorCli — argv parsing', () => {
  it('no args → help, exit 0', async () => {
    const r = await runDoctorCli([], PATHS);
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain('Usage:');
  });

  it('--fix without --data → usage error, exit 2', async () => {
    const r = await runDoctorCli(['--fix'], PATHS);
    expect(r.exitCode).toBe(2);
  });

  it('unknown flag → usage error, exit 2', async () => {
    const r = await runDoctorCli(['--data', '--bogus'], PATHS);
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain('--bogus');
  });

  it('--data clean → exit 0', async () => {
    const r = await runDoctorCli(['--data'], PATHS);
    expect(r.exitCode).toBe(0);
  });

  it('--data with issues → exit 1', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'bad.json'), '{nope');
    const r = await runDoctorCli(['--data'], PATHS);
    expect(r.exitCode).toBe(1);
  });

  it('--json produces parseable report', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'bad.json'), '{nope');
    const r = await runDoctorCli(['--data', '--json'], PATHS);
    const parsed = JSON.parse(r.text);
    expect(parsed.errors).toBe(1);
    expect(parsed.issues[0].check).toBe('corrupt-json');
  });
});

describe('formatReport', () => {
  it('groups issues by level+check with counts', async () => {
    await write(path.join(PATHS.tasksDir, 'acme', 'b1.json'), '{x');
    await write(path.join(PATHS.tasksDir, 'acme', 'b2.json'), '{y');
    await write(path.join(PATHS.knowledgeDir, 'doc-1.md'), docMd({ project: undefined }));
    const report = await scanDataDir(PATHS);
    const text = formatReport(report);
    expect(text).toContain('DATA_DIR:');
    expect(text).toContain('Scanned: 2 json, 1 md');
    expect(text).toMatch(/\[ERROR\] corrupt-json: 2/);
    expect(text).toMatch(/\[WARN\] knowledge-orphan: 1/);
    expect(text).toMatch(/doctor --data: 2 errors, 2 warnings, 0 fixed — exit 1/);
  });
});
