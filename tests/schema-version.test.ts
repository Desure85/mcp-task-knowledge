/**
 * DX-18 — DATA_DIR/.schema-version manifest + file-level migrations.
 *
 * Tests checkSchemaVersion() directly against fixture DATA_DIRs in tmp dirs —
 * no server context needed (same pattern as doctor-data.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import {
  checkSchemaVersion,
  readSchemaManifest,
  writeSchemaManifest,
  SchemaVersionError,
  CURRENT_SCHEMA,
  SCHEMA_MANIFEST_FILE,
  type SchemaMigrationPaths,
} from '../src/services/schema-version.js';
import { scanDataDir, formatReport, type DoctorPaths } from '../src/cli/doctor.js';

let ROOT: string;
let PATHS: SchemaMigrationPaths;

async function write(p: string, content: string) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf-8');
}

beforeEach(async () => {
  ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'schema-ver-'));
  PATHS = {
    dataDir: ROOT,
    tasksDir: path.join(ROOT, 'tasks'),
    knowledgeDir: path.join(ROOT, 'knowledge'),
  };
});

afterEach(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
});

describe('checkSchemaVersion — fresh install', () => {
  it('stamps manifest on empty DATA_DIR', async () => {
    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    expect(r.found).toBe(CURRENT_SCHEMA);
    expect(r.current).toBe(CURRENT_SCHEMA);
    expect(r.applied).toEqual([]);
    expect(r.manifestWritten).toBe(true);

    const m = await readSchemaManifest(ROOT);
    expect(m?.schema).toBe(CURRENT_SCHEMA);
    expect(m?.updatedBy).toBe('1.0.20-test');
    expect(m?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stamps manifest when DATA_DIR does not exist yet', async () => {
    const missing = path.join(ROOT, 'no-such-dir');
    const r = await checkSchemaVersion(
      { dataDir: missing, tasksDir: path.join(missing, 'tasks'), knowledgeDir: path.join(missing, 'knowledge') },
      '1.0.20-test',
    );
    expect(r.manifestWritten).toBe(true);
    const m = await readSchemaManifest(missing);
    expect(m?.schema).toBe(CURRENT_SCHEMA);
  });
});

describe('checkSchemaVersion — legacy data (no manifest)', () => {
  it('treats non-empty DATA_DIR without manifest as schema 0 and migrates', async () => {
    // Legacy layout: a task file exists but no .schema-version.
    await write(
      path.join(PATHS.tasksDir, 'acme', 'task-1.json'),
      JSON.stringify({ id: 'task-1', project: 'acme', title: 'T', status: 'pending', priority: 'medium', createdAt: 'x', updatedAt: 'x' }),
    );

    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    expect(r.found).toBe(0);
    expect(r.current).toBe(CURRENT_SCHEMA);
    expect(r.applied).toEqual([{ from: 0, to: 1, description: expect.stringContaining('baseline') }]);
    expect(r.manifestWritten).toBe(true);

    const m = await readSchemaManifest(ROOT);
    expect(m?.schema).toBe(CURRENT_SCHEMA);
  });

  it('dotfiles alone do not count as legacy data', async () => {
    await write(path.join(ROOT, '.embeddings', 'keep'), 'x');
    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    // Only dotfiles → treated as fresh, no migration.
    expect(r.found).toBe(CURRENT_SCHEMA);
    expect(r.applied).toEqual([]);
  });
});

describe('checkSchemaVersion — version comparison', () => {
  it('equal schema → no-op, manifest untouched', async () => {
    await writeSchemaManifest(ROOT, CURRENT_SCHEMA, '1.0.20-test');
    const before = await fsp.readFile(path.join(ROOT, SCHEMA_MANIFEST_FILE), 'utf-8');

    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    expect(r.found).toBe(CURRENT_SCHEMA);
    expect(r.applied).toEqual([]);
    expect(r.manifestWritten).toBe(false);

    const after = await fsp.readFile(path.join(ROOT, SCHEMA_MANIFEST_FILE), 'utf-8');
    expect(after).toBe(before);
  });

  it('newer schema → refuses with SchemaVersionError', async () => {
    await writeSchemaManifest(ROOT, CURRENT_SCHEMA + 1, '9.9.9-future');

    await expect(checkSchemaVersion(PATHS, '1.0.20-test')).rejects.toThrow(SchemaVersionError);
    await expect(checkSchemaVersion(PATHS, '1.0.20-test')).rejects.toThrow(
      /newer schema version.*upgrade the package/i,
    );
  });

  it('older manifest schema → migrates and rewrites manifest', async () => {
    await writeSchemaManifest(ROOT, 0, '0.9.0-old');
    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    expect(r.found).toBe(0);
    expect(r.applied.length).toBe(1);
    const m = await readSchemaManifest(ROOT);
    expect(m?.schema).toBe(CURRENT_SCHEMA);
    expect(m?.updatedBy).toBe('1.0.20-test');
  });

  it('corrupt manifest on non-empty dir → treated as legacy 0', async () => {
    await write(path.join(ROOT, SCHEMA_MANIFEST_FILE), '{not json');
    await write(path.join(PATHS.tasksDir, 'x.json'), '{}');
    const r = await checkSchemaVersion(PATHS, '1.0.20-test');
    expect(r.found).toBe(0);
    expect(r.manifestWritten).toBe(true);
  });
});

describe('doctor --data schema integration', () => {
  it('reports schema line and warns on missing manifest', async () => {
    await write(
      path.join(PATHS.tasksDir, 'acme', 'task-1.json'),
      JSON.stringify({ id: 'task-1', project: 'acme', title: 'T', status: 'pending', priority: 'medium', createdAt: 'x', updatedAt: 'x' }),
    );
    const doctorPaths: DoctorPaths = {
      dataDir: ROOT,
      tasksDir: PATHS.tasksDir,
      knowledgeDir: PATHS.knowledgeDir,
      projectsMetaDir: path.join(ROOT, 'projects'),
    };
    const r = await scanDataDir(doctorPaths);
    expect(r.schema).toEqual({ found: 'none', current: CURRENT_SCHEMA });
    // Missing manifest is reported via schema.found, not as an issue.
    expect(r.issues.filter((i) => i.check === 'schema-version')).toEqual([]);
    const text = formatReport(r);
    expect(text).toContain(`Schema: none (supported: ${CURRENT_SCHEMA})`);
  });

  it('reports error when manifest schema is newer', async () => {
    await writeSchemaManifest(ROOT, CURRENT_SCHEMA + 5, '9.9.9');
    const doctorPaths: DoctorPaths = {
      dataDir: ROOT,
      tasksDir: PATHS.tasksDir,
      knowledgeDir: PATHS.knowledgeDir,
      projectsMetaDir: path.join(ROOT, 'projects'),
    };
    const r = await scanDataDir(doctorPaths);
    expect(r.schema.found).toBe(CURRENT_SCHEMA + 5);
    expect(r.issues.some((i) => i.check === 'schema-version' && i.level === 'error')).toBe(true);
  });

  it('clean report when manifest matches', async () => {
    await writeSchemaManifest(ROOT, CURRENT_SCHEMA, '1.0.20-test');
    const doctorPaths: DoctorPaths = {
      dataDir: ROOT,
      tasksDir: PATHS.tasksDir,
      knowledgeDir: PATHS.knowledgeDir,
      projectsMetaDir: path.join(ROOT, 'projects'),
    };
    const r = await scanDataDir(doctorPaths);
    expect(r.schema.found).toBe(CURRENT_SCHEMA);
    expect(r.issues.filter((i) => i.check === 'schema-version')).toEqual([]);
  });
});
