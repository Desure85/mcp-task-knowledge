import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp-tests-obsidian-prompts-rt');
const VAULT = path.join(TMP, 'vault');
const STORE = path.join(TMP, 'store');
const PROJECT = 'mcp';

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }); } catch {}
}
async function exists(p: string) {
  try { await fsp.stat(p); return true; } catch { return false; }
}
async function mkdirp(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

describe('obsidian: prompts export -> import roundtrip', () => {
  let exp: any; let imp: any;

  beforeAll(async () => {
    await rmrf(TMP);
    await mkdirp(VAULT);
    await mkdirp(STORE);
    process.env.OBSIDIAN_VAULT_ROOT = VAULT;
    process.env.DATA_DIR = STORE;

    exp = await import('../src/obsidian/export.js');
    imp = await import('../src/obsidian/import.js');
  }, 30000);

  afterAll(async () => {
    await rmrf(TMP);
  });

  it('exports prompts to vault and imports them back (including builds/catalog, optional sources/md)', async () => {
    const promptsBase = path.join(STORE, 'prompts', PROJECT);
    // Seed prompts: sources (opt-in), builds, catalog, markdown
    const srcPrompts = path.join(promptsBase, 'prompts');
    const srcRules = path.join(promptsBase, 'rules');
    const srcWorkflows = path.join(promptsBase, 'workflows');
    const srcTemplates = path.join(promptsBase, 'templates');
    const srcPolicies = path.join(promptsBase, 'policies');
    const builds = path.join(promptsBase, 'exports', 'builds');
    const catalog = path.join(promptsBase, 'exports', 'catalog');
    const markdown = path.join(promptsBase, 'exports', 'markdown');

    await mkdirp(srcPrompts);
    await mkdirp(srcRules);
    await mkdirp(srcWorkflows);
    await mkdirp(srcTemplates);
    await mkdirp(srcPolicies);
    await mkdirp(builds);
    await mkdirp(catalog);
    await mkdirp(markdown);

    // Minimal files
    await fsp.writeFile(path.join(srcPrompts, 'MCP-PROMPT-ANA-001.json'), JSON.stringify({ id: 'MCP-PROMPT-ANA-001', version: 1, kind: 'prompt', name: 'Test Prompt' }, null, 2));
    await fsp.writeFile(path.join(srcRules, 'MCP-RULE-GEN-001.json'), JSON.stringify({ id: 'MCP-RULE-GEN-001', version: 1, kind: 'rule', name: 'Test Rule' }, null, 2));
    await fsp.writeFile(path.join(srcWorkflows, 'MCP-WORKFLOW-ANA-001.json'), JSON.stringify({ id: 'MCP-WORKFLOW-ANA-001', version: 1, kind: 'workflow', name: 'Test Workflow' }, null, 2));
    await fsp.writeFile(path.join(srcTemplates, 'MCP-TEMPLATE-001.json'), JSON.stringify({ id: 'MCP-TEMPLATE-001', version: 1, kind: 'template', name: 'Test Template' }, null, 2));
    await fsp.writeFile(path.join(srcPolicies, 'MCP-POLICY-001.json'), JSON.stringify({ id: 'MCP-POLICY-001', version: 1, kind: 'policy', name: 'Test Policy' }, null, 2));

    await fsp.writeFile(path.join(builds, 'build-index.json'), JSON.stringify({ items: ['MCP-PROMPT-ANA-001'] }, null, 2));
    await fsp.writeFile(path.join(catalog, 'prompts.catalog.json'), JSON.stringify({ items: { 'MCP-PROMPT-ANA-001': { id: 'MCP-PROMPT-ANA-001' } } }, null, 2));
    await fsp.writeFile(path.join(markdown, 'MCP-PROMPT-ANA-001.md'), '# Test Prompt\n');

    // Export to vault (replace)
    const er = await exp.exportProjectToVault(PROJECT, { strategy: 'replace', prompts: true, includePromptSourcesJson: true, includePromptSourcesMd: true });
    expect(er).toBeTruthy();
    const projRoot = path.join(VAULT, PROJECT);
    const vPrompts = path.join(projRoot, 'Prompts');
    expect(await exists(vPrompts)).toBe(true);
    // sanity: exported catalog/builds exist
    expect(await exists(path.join(vPrompts, 'catalog', 'prompts.catalog.json'))).toBe(true);
    expect(await exists(path.join(vPrompts, 'builds', 'build-index.json'))).toBe(true);

    // Cleanup store side to validate import restores
    await rmrf(promptsBase);

    // Import back from vault: include sources and markdown
    const ir = await imp.importProjectFromVault(PROJECT, { strategy: 'replace', prompts: true, importPromptSourcesJson: true, importPromptMarkdown: true });
    expect(ir).toBeTruthy();
    // Check copies reported
    expect(ir.promptsCopied).toBeTruthy();
    expect((ir.promptsCopied!.builds || 0) > 0).toBe(true);
    expect((ir.promptsCopied!.catalog || 0) > 0).toBe(true);
    expect((ir.promptsCopied!.sources || 0) > 0).toBe(true);
    expect((ir.promptsCopied!.markdown || 0) > 0).toBe(true);

    // Check filesystem restored at expected paths
    expect(await exists(path.join(promptsBase, 'exports', 'catalog', 'prompts.catalog.json'))).toBe(true);
    expect(await exists(path.join(promptsBase, 'exports', 'builds', 'build-index.json'))).toBe(true);
    expect(await exists(path.join(promptsBase, 'prompts', 'MCP-PROMPT-ANA-001.json'))).toBe(true);
    expect(await exists(path.join(promptsBase, 'exports', 'markdown', 'MCP-PROMPT-ANA-001.md'))).toBe(true);
  }, 30000);
});
