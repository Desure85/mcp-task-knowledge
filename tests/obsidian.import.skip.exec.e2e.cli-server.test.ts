import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-import-skip');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}
async function mkdirp(p: string) { await fsp.mkdir(p, { recursive: true }); }
async function writeFile(p: string, content: string) { await mkdirp(path.dirname(p)); await fsp.writeFile(p, content, 'utf-8'); }

async function seedVaultMinimal() {
  const projRoot = path.join(VAULT, PROJECT);
  await mkdirp(projRoot);
  await writeFile(path.join(projRoot, 'INDEX.md'), `# ${PROJECT}\n`);
  await writeFile(path.join(projRoot, 'Knowledge', 'E2E_DOC.md'), `---\ntitle: E2E_DOC\ntags: [e2e, import]\ntype: note\n---\nContent E2E doc\n`);
  await writeFile(path.join(projRoot, 'Tasks', 'E2E_TASK.md'), `---\ntitle: E2E_TASK\nstatus: pending\npriority: medium\ntags: [e2e, import]\n---\nTask body\n`);
}

function parseEnvelope(res: any) {
  const text = res?.content?.[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return { ok: false, error: { message: 'invalid json from server', raw: text } }; }
}

describe('obsidian_import_project — exec skip produces no new items on conflicts', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  beforeAll(async () => {
    await rmrf(TMP);
    await mkdirp(VAULT);
    await mkdirp(STORE);
    await seedVaultMinimal();

    transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...process.env,
        DATA_DIR: STORE,
        OBSIDIAN_VAULT_ROOT: VAULT,
        EMBEDDINGS_MODE: 'none',
      },
    });
    client = new Client({ name: 'e2e-client', version: '0.0.1' });
    await client.connect(transport);
  }, 60000);

  afterAll(async () => {
    try {
      // @ts-ignore
      if (client && typeof client.close === 'function') await (client as any).close();
      // @ts-ignore
      if (transport && typeof transport.close === 'function') await (transport as any).close();
    } catch {}
    await rmrf(TMP);
  }, 60000);

  it('baseline replace confirm then skip merge leads to 0 new imports', async () => {
    // baseline: replace + confirm
    const res1 = await client!.callTool({
      name: 'obsidian_import_project',
      arguments: { project: PROJECT, knowledge: true, tasks: true, strategy: 'replace', confirm: true },
    });
    const env1 = parseEnvelope(res1);
    expect(env1.ok).toBe(true);
    expect((env1.data?.knowledgeImported ?? 0) + (env1.data?.tasksImported ?? 0)).toBeGreaterThan(0);

    // second: merge skip should not create new items on same titles
    const res2 = await client!.callTool({
      name: 'obsidian_import_project',
      arguments: { project: PROJECT, knowledge: true, tasks: true, strategy: 'merge', mergeStrategy: 'skip' },
    });
    const env2 = parseEnvelope(res2);
    expect(env2.ok).toBe(true);
    expect(env2.data?.knowledgeImported ?? 0).toBe(0);
    expect(env2.data?.tasksImported ?? 0).toBe(0);
  }, 60000);
});
