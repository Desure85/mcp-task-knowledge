import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { anchorsOf, buildSuffixIndex, resolveRepoPath, lineInRange, verifyAnchors } from '../src/memory/verify.js';

const TMP_DIR = path.join(process.cwd(), '.tmp-tests-memory-verify');
const REPO = path.join(TMP_DIR, 'repo');

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
let handlers: Map<string, Handler>;

beforeAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
  await fsp.mkdir(path.join(REPO, 'src'), { recursive: true });
  await fsp.writeFile(path.join(REPO, 'src', 'alive.ts'), 'one\ntwo\nthree\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: REPO });
  execFileSync('git', ['add', '.'], { cwd: REPO });

  const { registerMemoryTools } = await import('../src/register/memory.js');
  handlers = new Map();
  const docs = [
    { id: 'fact-live', project: 'p', title: 'live src/alive.ts:2', updatedAt: '2026-01-01', type: 'memory_fact' },
    { id: 'fact-stale', project: 'p', title: 'gone src/missing.ts', updatedAt: '2026-01-01', type: 'memory_fact' },
    { id: 'fact-range', project: 'p', title: 'range src/alive.ts:99', updatedAt: '2026-01-01', type: 'memory_fact' },
    { id: 'fact-none', project: 'p', title: 'no anchors here', updatedAt: '2026-01-01', type: 'memory_fact' },
    { id: 'not-fact', project: 'p', title: 'ignored src/alive.ts', updatedAt: '2026-01-01', type: 'adr' },
  ];
  const storage = {
    docs: {
      list: async () => docs,
      read: async (_project: string, id: string) => ({ ...docs.find((d) => d.id === id), content: '' }),
    },
  };
  registerMemoryTools({
    server: { registerTool: (name: string, _def: unknown, handler: Handler) => handlers.set(name, handler) },
    storage,
  } as never);
});

afterAll(async () => {
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

function parse(result: unknown) {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return JSON.parse(content?.[0]?.text ?? '{}') as { ok: boolean; data?: any; error?: any };
}

describe('U-05 memory_verify', () => {
  it('extracts path/symbol anchors and resolves suffixes', () => {
    const anchors = anchorsOf('see src/a.ts:3-4 and Foo::bar and README.md', new Set(['src']));
    expect(anchors.map((a) => a.kind)).toEqual(['path', 'path', 'symbol']);
    expect(anchors[0]).toMatchObject({ kind: 'path', file: 'src/a.ts', from: 3, to: 4, strong: true });
    expect(anchors[1]).toMatchObject({ kind: 'path', file: 'README.md', strong: false });
    expect(anchors[2]).toMatchObject({ kind: 'symbol', className: 'Foo', method: 'bar' });

    const index = buildSuffixIndex(['src/deep/a.ts', 'src/b.ts']);
    expect(resolveRepoPath('a.ts', index)).toBe('src/deep/a.ts');
    expect(lineInRange(3, 4, 4)).toBe(true);
    expect(lineInRange(5, null, 4)).toBe(false);
  });

  it('classifies verified, stale, no-anchor and line drift', () => {
    const index = {
      files: ['src/alive.ts'],
      fileSet: new Set(['src/alive.ts']),
      suffixIndex: buildSuffixIndex(['src/alive.ts']),
      repoTops: new Set(['src']),
      lineCount: () => 3,
    };
    expect(verifyAnchors(anchorsOf('src/alive.ts:2'), index).status).toBe('verified');
    expect(verifyAnchors(anchorsOf('src/missing.ts'), index).status).toBe('stale');
    expect(verifyAnchors(anchorsOf('src/alive.ts:99'), index).status).toBe('stale');
    expect(verifyAnchors(anchorsOf('no anchors here'), index).status).toBe('no-anchor');
    // A bare weak filename may confirm, but never makes a fact stale.
    expect(verifyAnchors(anchorsOf('README.md'), index).status).toBe('no-anchor');
    // Symbol-only fact with no symbol lookup is honestly unknown, not verified.
    expect(verifyAnchors(anchorsOf('Foo::bar'), index).status).toBe('stale');
    expect(verifyAnchors(anchorsOf('Foo::bar'), { ...index, symbolExists: () => true }).status).toBe('verified');
  });

  it('tool scans memory_fact docs only and returns counts', async () => {
    const result = await handlers.get('memory_verify')!({ project: 'p', repo: REPO, limit: 50 });
    const body = parse(result);
    expect(body.ok).toBe(true);
    expect(body.data.scanned).toBe(4);
    expect(body.data.counts).toEqual({ verified: 1, 'pending-merge': 0, stale: 2, 'no-anchor': 1 });
    const byId = new Map(body.data.items.map((item: any) => [item.id, item.status]));
    expect(byId.get('fact-live')).toBe('verified');
    expect(byId.get('fact-stale')).toBe('stale');
    expect(byId.get('fact-range')).toBe('stale');
    expect(byId.get('fact-none')).toBe('no-anchor');
    expect(byId.has('not-fact')).toBe(false);
  });

  it('tool returns REPO_INVALID for a non-git directory', async () => {
    const body = parse(await handlers.get('memory_verify')!({ project: 'p', repo: TMP_DIR }));
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('REPO_INVALID');
  });
});
