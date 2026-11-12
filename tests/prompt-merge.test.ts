import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { mergePromptVersions } from '../src/prompts/merge.js';

const TMP = path.join(process.cwd(), '.tmp-tests-prompt-merge');
process.env.DATA_DIR = TMP;
process.env.OBSIDIAN_VAULT_ROOT = path.join(TMP, 'vault');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H = (a: Record<string, unknown>) => Promise<any>;
let tools: Map<string, H>;

beforeAll(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
  await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  const { registerPromptMergeTools } = await import('../src/register/prompt-merge.js');
  tools = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerPromptMergeTools({ server: { registerTool: (n: string, _d: unknown, h: H) => tools.set(n, h) } } as any);
});
afterAll(async () => { await fsp.rm(TMP, { recursive: true, force: true }); });

async function call(h: H, args: Record<string, unknown>) {
  const r = await h(args); const t = r?.content?.[0]?.text; return t ? JSON.parse(t) : r;
}

describe('Z-07 prompt merge', () => {
  it('fast-forwards a clean side change', () => {
    const r = mergePromptVersions({ base: 'a\n', local: 'a\n', remote: 'b\n' });
    expect(r.status).toBe('clean');
    expect(r.merged).toBe('b\n');
  });

  it('rejects a missing variable', () => {
    const r = mergePromptVersions({ base: '{{a}}', local: '{{a}}', remote: '' });
    expect(r.status).toBe('conflict');
    expect(r.conflicts.join(' ')).toContain('missing variable: a');
  });

  it('rejects a new allowed-tool', () => {
    const r = mergePromptVersions({ base: 'allowed-tools: Read\n', local: 'allowed-tools: Read\n', remote: 'allowed-tools: Read, Write\n' });
    expect(r.status).toBe('conflict');
    expect(r.conflicts.join(' ')).toContain('new allowed-tool: Write');
  });

  it('prepare/apply writes inside DATA_DIR and requires confirm for conflicts', async () => {
    const clean = await call(tools.get('prompts_merge_prepare')!, { base: 'x', local: 'x', remote: 'y' });
    expect(clean.ok).toBe(true);
    const applied = await call(tools.get('prompts_merge_apply')!, { draftId: clean.data.draftId, targetPath: 'prompts/out.txt' });
    expect(applied.ok).toBe(true);
    expect(await fsp.readFile(path.join(TMP, 'prompts/out.txt'), 'utf8')).toBe('y');

    const conflict = await call(tools.get('prompts_merge_prepare')!, { base: '{{a}}', local: '{{a}}', remote: '' });
    const denied = await call(tools.get('prompts_merge_apply')!, { draftId: conflict.data.draftId, targetPath: 'prompts/c.txt' });
    expect(denied.ok).toBe(false);
    const forced = await call(tools.get('prompts_merge_apply')!, { draftId: conflict.data.draftId, targetPath: 'prompts/c.txt', confirm: true });
    expect(forced.ok).toBe(true);
  });
});
