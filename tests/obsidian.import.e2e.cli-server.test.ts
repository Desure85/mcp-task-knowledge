import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-e2e-import-server');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}

async function mkdirp(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function writeFile(p: string, content: string) {
  await mkdirp(path.dirname(p));
  await fsp.writeFile(p, content, 'utf-8');
}

async function seedVaultMinimal() {
  const projRoot = path.join(VAULT, PROJECT);
  await mkdirp(projRoot);
  // INDEX.md — минимальный корень проекта
  await writeFile(path.join(projRoot, 'INDEX.md'), `# ${PROJECT}\n`);
  // Knowledge/Doc
  await writeFile(path.join(projRoot, 'Knowledge', 'E2E_DOC.md'), `---\ntitle: E2E_DOC\ntags: [e2e, import]\ntype: note\n---\nContent E2E doc\n`);
  // Tasks/Task — базовый формат
  await writeFile(path.join(projRoot, 'Tasks', 'E2E_TASK.md'), `---\ntitle: E2E_TASK\nstatus: pending\npriority: medium\ntags: [e2e, import]\n---\nTask body\n`);
}

function parseEnvelope(res: any) {
  // SDK возвращает { content: [{ type: 'text', text: JSON-string }] }
  const text = res?.content?.[0]?.text ?? '';
  try { return JSON.parse(text); } catch { return { ok: false, error: { message: 'invalid json from server', raw: text } }; }
}

describe('obsidian_import_project — full e2e via MCP server (stdio client)', () => {
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  beforeAll(async () => {
    await rmrf(TMP);
    await mkdirp(VAULT);
    await mkdirp(STORE);
    await seedVaultMinimal();

    // Поднимаем сервер через stdio-транспорт
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
      // best-effort закрытие транспорта/клиента
      // @ts-ignore
      if (client && typeof client.close === 'function') await (client as any).close();
      // @ts-ignore
      if (transport && typeof transport.close === 'function') await (transport as any).close();
    } catch {}
    await rmrf(TMP);
  }, 60000);

  it('dryRun envelope matches CLI contract (plan present)', async () => {
    const res = await client!.callTool({
      name: 'obsidian_import_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'merge',
        mergeStrategy: 'overwrite',
        dryRun: true,
      },
    });
    const env = parseEnvelope(res);
    expect(env.ok).toBe(true);
    expect(env.data?.project).toBe(PROJECT);
    expect(['merge', 'replace']).toContain(env.data?.strategy);
    expect(typeof env.data?.plan).toBe('object');
  }, 40000);

  it('replace not confirmed: expected error envelope', async () => {
    const res = await client!.callTool({
      name: 'obsidian_import_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'replace',
        // confirm omitted intentionally
      },
    });
    const env = parseEnvelope(res);
    expect(env.ok).toBe(false);
    expect(String(env.error?.message || '')).toContain('not confirmed');
  }, 40000);

  it('replace confirmed: expected ok envelope', async () => {
    const res = await client!.callTool({
      name: 'obsidian_import_project',
      arguments: {
        project: PROJECT,
        knowledge: true,
        tasks: true,
        strategy: 'replace',
        confirm: true,
      },
    });
    const env = parseEnvelope(res);
    expect(env.ok).toBe(true);
    // Плоская проверка структуры результата
    expect(typeof env.data).toBe('object');
  }, 40000);
});
