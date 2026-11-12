import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { buildBacklinks, parseWikiLinks } from '../src/knowledge/wiki.js';

const ROOT = path.join(process.cwd(), '.tmp-tests-wiki');
process.env.DATA_DIR = ROOT; process.env.OBSIDIAN_VAULT_ROOT = path.join(ROOT, 'vault');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type H = (a: Record<string, unknown>) => Promise<any>;
let tools: Map<string, H>; let k: typeof import('../src/storage/knowledge.js');

beforeAll(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(process.env.OBSIDIAN_VAULT_ROOT!, { recursive: true });
  k = await import('../src/storage/knowledge.js');
  const { registerWikiTools } = await import('../src/register/wiki.js');
  tools = new Map(); registerWikiTools({ server: { registerTool: (n: string, _d: unknown, h: H) => tools.set(n, h) } } as never);
});
afterAll(async () => { await fsp.rm(ROOT, { recursive: true, force: true }); });
async function call(h: H, a: Record<string, unknown>) { const r = await h(a); const t = r?.content?.[0]?.text; return t ? JSON.parse(t) : r; }

describe('T-05 wiki links', () => {
  it('parses links with labels and dedupes', () => {
    expect(parseWikiLinks('[[A]] [[B|bee]] [[A]]')).toEqual(['A', 'B']);
  });
  it('resolves backlinks by title slug', async () => {
    const target = await k.createDoc({ project: 'mcp', title: 'Target Doc', content: '# t' });
    const source = await k.createDoc({ project: 'mcp', title: 'Source Doc', content: 'See [[Target Doc]]' });
    const docs = [{ id: target.id, title: target.title, content: target.content }, { id: source.id, title: source.title, content: source.content }];
    const links = buildBacklinks(docs).get(target.id) ?? [];
    expect(links.map((l) => l.id)).toContain(source.id);
  });
  it('backlinks and wikilinks tools work; publish changes status', async () => {
    const target = await k.createDoc({ project: 'mcp', title: 'Wiki T', content: 'x' });
    const source = await k.createDoc({ project: 'mcp', title: 'Wiki S', content: '[[Wiki T]]' });
    const back = await call(tools.get('knowledge_backlinks')!, { project: 'mcp', id: target.id });
    expect(back.ok).toBe(true); // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(back.data.backlinks.map((b: any) => b.id)).toContain(source.id);
    const out = await call(tools.get('knowledge_wikilinks')!, { project: 'mcp', id: source.id });
    expect(out.data.links[0]).toMatchObject({ target: 'Wiki T', resolvedId: target.id });
    const pub = await call(tools.get('knowledge_publish')!, { project: 'mcp', id: source.id, status: 'draft' });
    expect(pub.data.status).toBe('draft');
  });
});
describe('T-05 templates/review/stale', () => {
  it('lists and renders templates', async () => {
    await fsp.mkdir(path.join(ROOT, 'knowledge-templates'), { recursive: true });
    await fsp.writeFile(path.join(ROOT, 'knowledge-templates', 'adr.md'), '# ADR {{title}}\nProject: {{project}}\nDate: {{date}}\n', 'utf8');
    const list = await call(tools.get('knowledge_template_list')!, {});
    expect(list.data.templates.map((t: { id: string }) => t.id)).toContain('adr');
    const rendered = await call(tools.get('knowledge_template_apply')!, { templateId: 'adr', title: 'Cache', project: 'mcp' });
    expect(rendered.data.content).toContain('# ADR Cache');
    expect(rendered.data.content).toContain('Project: mcp');
  });

  it('records review and finds stale docs', async () => {
    const doc = await k.createDoc({ project: 'mcp', title: 'Old doc', content: 'x' });
    const reviewed = await call(tools.get('knowledge_review')!, { project: 'mcp', id: doc.id, reviewer: 'alice', publish: true });
    expect(reviewed.data.reviewedBy).toBe('alice');
    expect(reviewed.data.status).toBe('published');
    const stale = await call(tools.get('knowledge_stale')!, { project: 'mcp', days: 1 });
    expect(stale.ok).toBe(true);
    expect(Array.isArray(stale.data.documents)).toBe(true);
  });
});