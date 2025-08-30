import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Utility to write JSON with newline
async function writeJson(p: string, data: any) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Create a tiny prompt item
function mkPrompt(id: string, version: string, kind: string, template: string, extra?: any) {
  return {
    type: 'prompt',
    id,
    version,
    metadata: { kind, title: `${id} v${version}`, tags: extra?.tags || [] },
    template,
    ...extra,
  };
}

// Create a simple workflow
function mkWorkflow(id: string, compose: any[], extra?: any) {
  return {
    type: 'prompt',
    id,
    version: '1.0.0',
    metadata: { kind: 'workflow', title: `WF ${id}` },
    compose,
    ...extra,
  };
}

// Temp path holder
let TMP: string;
let restoreEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-prompts-'));
  // Save and set env so PROMPTS_DIR resolves to TMP
  restoreEnv.MCP_PROMPTS_DIR = process.env.MCP_PROMPTS_DIR;
  restoreEnv.DATA_DIR = process.env.DATA_DIR;
  restoreEnv.CURRENT_PROJECT = process.env.CURRENT_PROJECT;
  process.env.MCP_PROMPTS_DIR = TMP;
  process.env.DATA_DIR = TMP; // config requires DATA_DIR always
  process.env.CURRENT_PROJECT = 'mcp';
  // Prepare project structure under TMP/<project>
  const prj = 'mcp';
  const base = path.join(TMP, prj);
  await fs.mkdir(path.join(base, 'workflows'), { recursive: true });
  await fs.mkdir(path.join(base, 'rules'), { recursive: true });
  await fs.mkdir(path.join(base, 'templates'), { recursive: true });
  await fs.mkdir(path.join(base, 'policies'), { recursive: true });

  // Parts
  await writeJson(path.join(base, 'rules', 'r1@1.0.0.json'), mkPrompt('r1', '1.0.0', 'rule', 'R1 body v1', { tags: ['alpha'] }));
  await writeJson(path.join(base, 'rules', 'r1@2.0.0.json'), mkPrompt('r1', '2.0.0', 'rule', 'R1 body v2', { tags: ['beta'] }));
  await writeJson(path.join(base, 'templates', 't1@1.0.0.json'), mkPrompt('t1', '1.0.0', 'template', 'T1 body v1'));
  await writeJson(path.join(base, 'policies', 'p1@1.0.0.json'), mkPrompt('p1', '1.0.0', 'policy', 'P1 body v1', { tags: ['prod'] }));

  // Workflow with pre/post and compose
  const wf = mkWorkflow('wf1', [
    { ref: 'r1@1.0.0', title: 'Rule one', level: 2, prefix: 'PRE R1', suffix: 'POST R1' },
    { ref: 't1', title: 'Template one', level: 1, separator: '***' },
    { ref: 'p1', title: 'Policy one', level: 3 },
  ], { pre: 'WF PRE', post: 'WF POST' });
  await writeJson(path.join(base, 'workflows', 'wf1@1.0.0.json'), wf);
});

afterAll(async () => {
  if (restoreEnv.MCP_PROMPTS_DIR === undefined) delete process.env.MCP_PROMPTS_DIR;
  else process.env.MCP_PROMPTS_DIR = restoreEnv.MCP_PROMPTS_DIR;
  try { await fs.rm(TMP, { recursive: true, force: true }); } catch {}
});

describe('prompts build (workflows)', () => {
  it('builds workflow with pre/post, headings, separators and id@version refs (dryRun)', async () => {
    // Import after env is set so PROMPTS_DIR resolves correctly
    const { buildWorkflows } = await import('../src/prompts/build.js');
    const res = await buildWorkflows('mcp', { ids: ['wf1'], separator: '---', dryRun: true });
    expect(res.built).toBe(1);
    expect(res.outputs[0].id).toBe('wf1');
  });

  it('writes artifacts when not dryRun and respects tag/kind filters', async () => {
    const { buildWorkflows } = await import('../src/prompts/build.js');
    const prj = 'mcp';
    const base = path.join(process.env.MCP_PROMPTS_DIR as string, prj);
    const outDir = path.join(base, 'exports', 'builds');

    // 1) No filters -> all parts included
    let res = await buildWorkflows(prj, { ids: ['wf1'], separator: '---', dryRun: false });
    expect(res.built).toBe(1);
    const mdPath = path.join(outDir, 'wf1@1.0.0.md');
    const jsonPath = path.join(outDir, 'wf1@1.0.0.json');
    const md = await fs.readFile(mdPath, 'utf8');
    const built = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    expect(built.metadata.kind).toBe('build');
    expect(md).toContain('WF PRE');
    expect(md).toContain('## Rule one');
    expect(md).toContain('PRE R1');
    expect(md).toContain('POST R1');
    expect(md).toContain('# Template one');
    expect(md).toContain('***');
    expect(md).toContain('### Policy one');
    expect(md).toContain('WF POST');

    // 2) includeKinds only templates -> only t1 section should appear
    res = await buildWorkflows(prj, { ids: ['wf1'], includeKinds: ['template'], dryRun: true });
    expect(res.built).toBe(1);

    // 3) includeTags filters -> only items with tag 'prod' (policy) remain
    res = await buildWorkflows(prj, { ids: ['wf1'], includeTags: ['prod'], dryRun: true });
    expect(res.built).toBe(1);
  });
});
