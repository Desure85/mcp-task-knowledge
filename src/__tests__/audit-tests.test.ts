/**
 * Known-answer test for scripts/audit-tests.mjs (TR-04).
 *
 * The audit script is an instrument: if its heuristics break, every conclusion
 * drawn from it becomes worthless. So it is calibrated on a synthetic tree where
 * the correct answer for each file is known in advance — the same way a test
 * that lies is proven by mutation, not by reading.
 *
 * The tree is built in the OS temp dir, never inside the repository, so vitest
 * cannot discover the fixtures as real tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../../scripts/audit-tests.mjs');

interface AuditRecord {
  file: string;
  consumption: string;
  indirectSrc: boolean;
  mockSut: number;
  tests: number;
  expects: number;
  assertFreeTests: number;
  tautologies: number;
  score: number;
  verdict: string;
}

interface AuditReport {
  totalFiles: number;
  summary: Record<string, number>;
  all: AuditRecord[];
}

let root = '';
let report: AuditReport;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tests-fixture-'));
  write('src/foo.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
  write('dist/index.js', '// built entry, spawn target\n');
  write('scripts/tool.mjs', 'export const x = 1;\n');
  // Test helper that spawns the built server — the shape of tests/e2e-full/harness.ts.
  write(
    'tests/harness.ts',
    "import { spawn } from 'node:child_process';\n" +
      "export function run() {\n  return spawn('node', ['dist/index.js'], { stdio: 'pipe' });\n}\n",
  );
  // Re-export barrel: reaches src only through a local helper file.
  write('tests/helpers/reexport.ts', "export { add } from '../../src/foo.js';\n");

  write(
    'tests/honest.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { add } from '../src/foo.js';\n" +
      "describe('add', () => {\n  it('adds', () => {\n    expect(add(1, 2)).toBe(3);\n    expect(add(0, 0)).toBe(0);\n  });\n});\n",
  );
  write(
    'tests/via-barrel.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { add } from './helpers/reexport.js';\n" +
      "describe('barrel', () => {\n  it('adds through a helper', () => {\n    expect(add(2, 2)).toBe(4);\n  });\n});\n",
  );
  // Subprocess whose script path is built with path.join — the shape of
  // tests/devcycle-state.test.ts. The literal `scripts/x.mjs` never appears.
  write(
    'tests/subprocess-var.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { execFile } from 'node:child_process';\n" +
      "import path from 'node:path';\n" +
      "const ROOT = process.cwd();\n" +
      "const SCRIPT = path.join(ROOT, 'scripts', 'tool.mjs');\n" +
      "describe('tooling', () => {\n  it('runs', async () => {\n" +
      "    const out = await new Promise((resolve) => execFile(process.execPath, [SCRIPT], (_e, o) => resolve(o)));\n" +
      "    expect(String(out)).toBeDefined();\n  });\n});\n",
  );
  // Promisified execFile — the shape of tests/executable-docs.test.ts.
  write(
    'tests/subprocess-promisified.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { execFile } from 'node:child_process';\n" +
      "import { promisify } from 'node:util';\n" +
      "import path from 'node:path';\n" +
      "const execFileAsync = promisify(execFile);\n" +
      "const SCRIPT = path.join(process.cwd(), 'scripts', 'tool.mjs');\n" +
      "describe('docs', () => {\n  it('runs', async () => {\n" +
      "    const { stdout } = await execFileAsync(process.execPath, [SCRIPT]);\n" +
      "    expect(stdout.length).toBeGreaterThanOrEqual(0);\n  });\n});\n",
  );
  // Real disjunction: must NOT be reported as a tautology.
  write(
    'tests/disjunction-ok.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { add } from '../src/foo.js';\n" +
      "describe('disjunction', () => {\n  it('checks a real union', () => {\n" +
      "    const v: string | null = String(add(1, 2));\n" +
      "    expect(v === null || typeof v === 'string').toBe(true);\n  });\n});\n",
  );
  // Exact complement: cannot fail, must be reported.
  write(
    'tests/complement-tautology.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "describe('complement', () => {\n  it('cannot fail', () => {\n" +
      "    const flag = true;\n" +
      "    expect(flag === true || flag === false).toBe(true);\n  });\n});\n",
  );
  write(
    'tests/via-harness.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { run } from './harness.js';\n" +
      "describe('server', () => {\n  it('starts', async () => {\n    const child = run();\n    expect(child.pid).toBeDefined();\n    child.kill();\n  });\n});\n",
  );
  // The lie: re-implements the subject inline and never imports it.
  write(
    'tests/lying.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      'function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      "describe('inline copy', () => {\n  it('adds', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n",
  );
  write(
    'tests/tautology.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "describe('tautology', () => {\n  it('cannot fail', () => {\n    expect(true).toBe(true);\n  });\n});\n",
  );
  write(
    'tests/mock-sut.test.ts',
    "import { describe, it, expect, vi } from 'vitest';\n" +
      "vi.mock('../src/foo.js', () => ({ add: () => 3 }));\n" +
      "import { add } from '../src/foo.js';\n" +
      "describe('mocked subject', () => {\n  it('passes against the mock', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n",
  );
  write(
    'tests/assertfree.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "import { add } from '../src/foo.js';\n" +
      "describe('no asserts', () => {\n  it('only calls', () => {\n    add(1, 2);\n  });\n  it('asserts', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});\n",
  );
  write(
    'tests/indirect.test.ts',
    "import { describe, it, expect } from 'vitest';\n" +
      "const FOO = '../src/foo.ts';\n" +
      "describe('variable import', () => {\n  it('loads', async () => {\n    const mod = await import(FOO);\n    expect(typeof mod.add).toBe('function');\n  });\n});\n",
  );

  const out = execFileSync(process.execPath, [SCRIPT, '--root', root, '--json', '--top', '100'], {
    encoding: 'utf8',
  });
  report = JSON.parse(out) as AuditReport;
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function record(file: string): AuditRecord {
  const found = report.all.find((r) => r.file === file);
  if (!found) throw new Error(`audit report has no record for ${file}`);
  return found;
}

describe('audit-tests.mjs — known answers', () => {
  it('discovers test files and skips helpers, sources and dist', () => {
    expect(report.totalFiles).toBe(12);
    expect(report.all.map((r) => r.file)).not.toContain('tests/harness.ts');
    expect(report.all.map((r) => r.file)).not.toContain('src/foo.ts');
  });

  it('honest direct import is OK with score 0', () => {
    const r = record('tests/honest.test.ts');
    expect(r.consumption).toBe('direct-src');
    expect(r.verdict).toBe('OK');
    expect(r.score).toBe(0);
    expect(r.expects).toBe(2);
  });

  it('reaches src through a local helper file', () => {
    expect(record('tests/via-barrel.test.ts').consumption).toBe('direct-src');
  });

  it('recognises a subprocess whose script path is built with path.join', () => {
    const r = record('tests/subprocess-var.test.ts');
    expect(r.consumption).toBe('subprocess-scripts');
  });

  it('recognises promisified execFile of a script', () => {
    const r = record('tests/subprocess-promisified.test.ts');
    expect(r.consumption).toBe('subprocess-scripts');
  });

  it('recognises a spawn of dist/index.js behind a test helper', () => {
    const r = record('tests/via-harness.test.ts');
    expect(r.consumption).toBe('subprocess-dist');
    expect(r.verdict).toBe('E2E');
  });

  it('flags a test that re-implements its subject as NO-SUT', () => {
    const r = record('tests/lying.test.ts');
    expect(r.verdict).toBe('NO-SUT');
    expect(r.score).toBeGreaterThanOrEqual(50);
  });

  it('flags literal tautologies', () => {
    const r = record('tests/tautology.test.ts');
    expect(r.verdict).toBe('TAUTOLOGY');
    expect(r.tautologies).toBe(1);
  });

  it('flags a test that mocks its own subject', () => {
    const r = record('tests/mock-sut.test.ts');
    expect(r.verdict).toBe('MOCK-SUT');
    expect(r.mockSut).toBe(1);
  });

  it('flags a test case without a single assertion', () => {
    const r = record('tests/assertfree.test.ts');
    expect(r.verdict).toBe('NO-ASSERT');
    expect(r.assertFreeTests).toBe(1);
    expect(r.tests).toBe(2);
  });

  it('does not call a real disjunction a tautology', () => {
    const r = record('tests/disjunction-ok.test.ts');
    expect(r.tautologies).toBe(0);
    expect(r.verdict).toBe('OK');
  });

  it('flags the exact complement pattern as a tautology', () => {
    const r = record('tests/complement-tautology.test.ts');
    expect(r.tautologies).toBe(1);
    expect(r.verdict).toBe('TAUTOLOGY');
  });

  it('marks variable imports as indirect and lowers the score', () => {
    const r = record('tests/indirect.test.ts');
    expect(r.indirectSrc).toBe(true);
    expect(r.verdict).toBe('NO-SUT');
    expect(r.score).toBe(35);
  });
});
