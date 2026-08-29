/**
 * tests/schema-validation.test.ts — JSON Schema validation tests (Q-007)
 *
 * Uses Ajv (draft-07 + formats) to verify:
 *   - Every schema under schemas/ is itself valid (meta-schema compile)
 *   - Valid data examples pass
 *   - Invalid data examples fail with the expected violation
 * Mirrors scripts/validate-schemas.mjs but as deterministic unit tests.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMAS_DIR = path.join(process.cwd(), 'schemas');

function loadSchemas(): Array<{ file: string; name: string; schema: Record<string, unknown> }> {
  const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((file) => ({
    file,
    name: file.replace('.schema.json', ''),
    schema: JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf8')),
  }));
}

function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

function makeAjv2020(): Ajv2020 {
  // ajv-formats' addFormats works with Ajv2020 instances too (formats are draft-agnostic)
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv;
}

describe('Q-007: schema validity (meta-schema)', () => {
  const schemas = loadSchemas();

  it('every schema file is valid JSON and compiles with Ajv', () => {
    const ajv = makeAjv();
    const ajv2020 = makeAjv2020();
    for (const s of schemas) {
      const draft = (s.schema as { $schema?: string }).$schema ?? '';
      const compiler = draft.includes('2020-12') ? ajv2020 : ajv;
      expect(() => compiler.compile(s.schema), `schema ${s.file} must compile`).not.toThrow();
    }
  });

  it('schemas directory contains the expected schemas', () => {
    const names = schemas.map((s) => s.name).sort();
    expect(names).toContain('task');
    expect(names).toContain('knowledge');
    expect(names).toContain('prompt');
    expect(names).toContain('feedback.event');
  });
});

describe('Q-007: task.schema.json validation', () => {
  const ajv = makeAjv();
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, 'task.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);

  const validTask = {
    id: 'task-1',
    project: 'mcp',
    title: 'Valid task',
    status: 'in_progress',
    priority: 'high',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };

  it('accepts a valid task', () => {
    expect(validate(validTask)).toBe(true);
  });

  it('accepts optional fields (tags, links, archived)', () => {
    const withOpts = {
      ...validTask,
      tags: ['a', 'b'],
      links: ['https://x'],
      archived: false,
      trashed: false,
      parentId: null,
    };
    expect(validate(withOpts)).toBe(true);
  });

  it('rejects missing required field (title)', () => {
    const { title, ...noTitle } = validTask;
    expect(validate(noTitle)).toBe(false);
    expect(validate.errors?.[0]?.instancePath).toBe('');
    expect(validate.errors?.[0]?.params?.missingProperty).toBe('title');
  });

  it('rejects invalid status enum', () => {
    expect(validate({ ...validTask, status: 'done' })).toBe(false);
  });

  it('rejects invalid priority enum', () => {
    expect(validate({ ...validTask, priority: 'urgent' })).toBe(false);
  });

  it('rejects invalid date-time format', () => {
    expect(validate({ ...validTask, createdAt: 'not-a-date' })).toBe(false);
  });

  it('rejects unknown properties (additionalProperties: false)', () => {
    expect(validate({ ...validTask, bogus: 1 })).toBe(false);
  });
});

describe('Q-007: knowledge.schema.json validation', () => {
  const ajv = makeAjv();
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, 'knowledge.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);

  const validDoc = {
    id: 'doc-1',
    project: 'mcp',
    title: 'Valid doc',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };

  it('accepts a valid knowledge doc', () => {
    expect(validate(validDoc)).toBe(true);
  });

  it('accepts extra properties (additionalProperties: true)', () => {
    expect(validate({ ...validDoc, type: 'note', source: 'internal', custom: 42 })).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { id, ...noId } = validDoc;
    expect(validate(noId)).toBe(false);
  });

  it('rejects invalid date-time', () => {
    expect(validate({ ...validDoc, updatedAt: 'yesterday' })).toBe(false);
  });
});

describe('Q-007: cross-schema consistency', () => {
  it('task schema allows parentId null and string (tree structure)', () => {
    const ajv = makeAjv();
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, 'task.schema.json'), 'utf8'));
    const validate = ajv.compile(schema);
    const base = {
      id: 't', project: 'p', title: 'x',
      status: 'pending', priority: 'low',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    };
    expect(validate({ ...base, parentId: 'parent-1' })).toBe(true);
    expect(validate({ ...base, parentId: null })).toBe(true);
  });
});
