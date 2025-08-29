import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfig, PROMPTS_DIR } from '../config.js';
import { ensureDir, writeText } from '../fs.js';
import { listDocs, readDoc } from '../storage/knowledge.js';
import { listTasksTree, listTasks } from '../storage/tasks.js';
import type { KnowledgeDocMeta } from '../types.js';

function toFrontmatter(obj: Record<string, any>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const it of v) lines.push(`  - ${String(it)}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

interface ExportOptions {
  knowledge?: boolean; // default true
  tasks?: boolean;     // default true
  strategy?: 'merge' | 'replace'; // default 'merge'
  // Prompts (Prompt Library)
  prompts?: boolean; // default true
  includePromptSourcesJson?: boolean; // default false
  includePromptSourcesMd?: boolean;   // default false
  // Filters common/knowledge
  includeArchived?: boolean; // default false
  updatedFrom?: string; // ISO8601, compare by updatedAt
  updatedTo?: string;   // ISO8601, compare by updatedAt
  includeTags?: string[];
  excludeTags?: string[];
  // Knowledge-only
  includeTypes?: string[];
  excludeTypes?: string[];
  // Tasks-only
  includeStatus?: Array<'pending' | 'in_progress' | 'completed' | 'closed'>;
  includePriority?: Array<'low' | 'medium' | 'high'>;
  // Structure control
  keepOrphans?: boolean; // default false: export only selected + their ancestors
}

export interface ExportResult {
  project?: string;
  vaultRoot: string;
  knowledgeCount: number;
  tasksCount: number;
  promptsCount?: number;
}

export interface ExportPlanResult {
  project?: string;
  vaultRoot: string;
  strategy: 'merge' | 'replace';
  knowledge: boolean;
  tasks: boolean;
  prompts: boolean;
  knowledgeCount: number;
  tasksCount: number;
  promptsCount: number;
  willDeleteDirs: string[];
}

// Compute a dry-run export plan with the same filters used by exportProjectToVault
export async function planExportProjectToVault(project?: string, opts?: ExportOptions): Promise<ExportPlanResult> {
  const cfg = loadConfig();
  const vaultRoot = cfg.obsidian.vaultRoot;
  const pfx = project || '';
  const projectRoot = path.join(vaultRoot, pfx ? pfx : '');
  const knowledgeDir = path.join(projectRoot, 'Knowledge');
  const tasksDir = path.join(projectRoot, 'Tasks');
  const promptsDir = path.join(projectRoot, 'Prompts');
  const doKnowledge = opts?.knowledge !== false;
  const doTasks = opts?.tasks !== false;
  const doPrompts = opts?.prompts !== false;
  const strategy: 'merge' | 'replace' = opts?.strategy || 'merge';
  const includeArchived = opts?.includeArchived === true;
  const updatedFrom = opts?.updatedFrom ? new Date(opts.updatedFrom) : undefined;
  const updatedTo = opts?.updatedTo ? new Date(opts.updatedTo) : undefined;
  const includeTags = opts?.includeTags && opts.includeTags.length ? new Set(opts.includeTags) : undefined;
  const excludeTags = opts?.excludeTags && opts.excludeTags.length ? new Set(opts.excludeTags) : undefined;
  const includeTypes = opts?.includeTypes && opts.includeTypes.length ? new Set(opts.includeTypes) : undefined;
  const excludeTypes = opts?.excludeTypes && opts.excludeTypes.length ? new Set(opts.excludeTypes) : undefined;
  const includeStatus = opts?.includeStatus && opts.includeStatus.length ? new Set(opts.includeStatus) : undefined;
  const includePriority = opts?.includePriority && opts.includePriority.length ? new Set(opts.includePriority) : undefined;
  const keepOrphans = opts?.keepOrphans === true;

  // Knowledge selection and closure
  let kCount = 0;
  if (doKnowledge) {
    const metas = await listDocs({ project, includeArchived });
    const kById = new Map(metas.map(m => [m.id, m] as const));
    const kSelected = new Set<string>();
    function kMatches(m: KnowledgeDocMeta): boolean {
      const ua = m.updatedAt ? new Date(m.updatedAt) : undefined;
      if (updatedFrom && ua && ua < updatedFrom) return false;
      if (updatedTo && ua && ua > updatedTo) return false;
      const tags = (m.tags as any) as string[] | undefined;
      if (excludeTags && tags && tags.some(t => excludeTags.has(t))) return false;
      if (includeTags && (!tags || !tags.some(t => includeTags.has(t)))) return false;
      const t = (m as any).type as string | undefined;
      if (excludeTypes && t && excludeTypes.has(t)) return false;
      if (includeTypes && (!t || !includeTypes.has(t))) return false;
      return true;
    }
    for (const m of metas) if (kMatches(m)) kSelected.add(m.id);
    const kClosure = new Set<string>();
    if (keepOrphans) {
      for (const m of metas) kClosure.add(m.id);
    } else {
      const visited = new Set<string>();
      for (const id of kSelected) {
        let cur: KnowledgeDocMeta | undefined = kById.get(id);
        while (cur && !visited.has(cur.id)) {
          visited.add(cur.id);
          kClosure.add(cur.id);
          const pid = (cur as any).parentId || null;
          if (pid) cur = kById.get(pid as string); else break;
        }
      }
    }
    kCount = kClosure.size;
  }

  // Tasks selection and closure
  let tCount = 0;
  if (doTasks) {
    const list = await listTasks({ project, includeArchived });
    const tById = new Map<string, any>();
    const tParent = new Map<string, string | null>();
    for (const t of list) {
      tById.set(t.id, t);
      tParent.set(t.id, t.parentId ?? null);
    }
    function tMatches(n: any): boolean {
      if (includeStatus && !includeStatus.has(n.status)) return false;
      if (includePriority && !includePriority.has(n.priority)) return false;
      const tags = (n.tags as string[] | undefined) || [];
      if (excludeTags && tags.some(t => excludeTags.has(t))) return false;
      if (includeTags && !tags.some(t => includeTags.has(t))) return false;
      const ua = n.updatedAt ? new Date(n.updatedAt) : undefined;
      if (updatedFrom && ua && ua < updatedFrom) return false;
      if (updatedTo && ua && ua > updatedTo) return false;
      return true;
    }
    const tSelected = new Set<string>();
    for (const t of tById.values()) if (tMatches(t)) tSelected.add(t.id);
    const tClosure = new Set<string>();
    if (keepOrphans) {
      for (const id of tById.keys()) tClosure.add(id);
    } else {
      const visited = new Set<string>();
      for (const id of tSelected) {
        let cur: string | null | undefined = id;
        while (cur && !visited.has(cur)) {
          visited.add(cur);
          tClosure.add(cur);
          cur = tParent.get(cur) ?? null;
        }
      }
    }
    tCount = tClosure.size;
  }

  const willDelete: string[] = [];
  if (strategy === 'replace') {
    if (doKnowledge) willDelete.push(knowledgeDir);
    if (doTasks) willDelete.push(tasksDir);
    if (doPrompts) willDelete.push(promptsDir);
  }

  // Prompts counting (best-effort): prefer catalog items count, fallback to number of build jsons
  let pCount = 0;
  if (doPrompts) {
    try {
      const catPath = path.join(PROMPTS_DIR, project || 'mcp', 'exports', 'catalog', 'prompts.catalog.json');
      const raw = await fs.readFile(catPath, 'utf8');
      const man = JSON.parse(raw);
      pCount = man && man.items ? Object.keys(man.items).length : 0;
    } catch {
      try {
        const buildsDir = path.join(PROMPTS_DIR, project || 'mcp', 'exports', 'builds');
        const items = await fs.readdir(buildsDir);
        pCount = items.filter(n => n.endsWith('.json')).length;
      } catch {}
    }
  }

  return {
    project,
    vaultRoot,
    strategy,
    knowledge: doKnowledge,
    tasks: doTasks,
    prompts: doPrompts,
    knowledgeCount: kCount,
    tasksCount: tCount,
    promptsCount: pCount,
    willDeleteDirs: willDelete,
  };
}

export async function exportProjectToVault(project?: string, opts?: ExportOptions): Promise<ExportResult> {
  const cfg = loadConfig();
  const vaultRoot = cfg.obsidian.vaultRoot;
  const pfx = project || '';

  const projectRoot = path.join(vaultRoot, pfx ? pfx : '');
  const knowledgeDir = path.join(projectRoot, 'Knowledge');
  const tasksDir = path.join(projectRoot, 'Tasks');
  const promptsDir = path.join(projectRoot, 'Prompts');
  const doKnowledge = opts?.knowledge !== false;
  const doTasks = opts?.tasks !== false;
  const doPrompts = opts?.prompts !== false;
  const strategy: 'merge' | 'replace' = opts?.strategy || 'merge';
  const includeArchived = opts?.includeArchived === true;
  const updatedFrom = opts?.updatedFrom ? new Date(opts.updatedFrom) : undefined;
  const updatedTo = opts?.updatedTo ? new Date(opts.updatedTo) : undefined;
  const includeTags = opts?.includeTags && opts.includeTags.length ? new Set(opts.includeTags) : undefined;
  const excludeTags = opts?.excludeTags && opts.excludeTags.length ? new Set(opts.excludeTags) : undefined;
  const includeTypes = opts?.includeTypes && opts.includeTypes.length ? new Set(opts.includeTypes) : undefined;
  const excludeTypes = opts?.excludeTypes && opts.excludeTypes.length ? new Set(opts.excludeTypes) : undefined;
  const includeStatus = opts?.includeStatus && opts.includeStatus.length ? new Set(opts.includeStatus) : undefined;
  const includePriority = opts?.includePriority && opts.includePriority.length ? new Set(opts.includePriority) : undefined;
  const keepOrphans = opts?.keepOrphans === true;

  // If replace strategy, clear selected target directories to avoid stale files
  if (strategy === 'replace') {
    try {
      if (doKnowledge) {
        await fs.rm(knowledgeDir, { recursive: true, force: true });
      }
      if (doTasks) {
        await fs.rm(tasksDir, { recursive: true, force: true });
      }
      if (doPrompts) {
        await fs.rm(promptsDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  if (doKnowledge) await ensureDir(knowledgeDir);
  if (doTasks) await ensureDir(tasksDir);
  if (doPrompts) await ensureDir(promptsDir);

  // --- Export knowledge: hierarchical by parentId/type with filters ---
  let knowledgeCount = 0;
  let kMap = new Map<string, KnowledgeDocMeta>();
  let kChildren = new Map<string | null, KnowledgeDocMeta[]>();
  let kSelected = new Set<string>();
  let kClosure = new Set<string>();
  if (doKnowledge) {
    const metas = await listDocs({ project, includeArchived });
    kMap = new Map<string, KnowledgeDocMeta>();
    metas.forEach((m) => kMap.set(m.id, m));

    // Build adjacency list
    kChildren = new Map<string | null, KnowledgeDocMeta[]>();
    for (const m of metas) {
      const pid = (m as any).parentId || null;
      if (!kChildren.has(pid)) kChildren.set(pid, []);
      kChildren.get(pid)!.push(m);
    }

    // Determine selection by filters (exclude has precedence over include)
    function matchesDoc(m: KnowledgeDocMeta): boolean {
      const ua = m.updatedAt ? new Date(m.updatedAt) : undefined;
      if (updatedFrom && ua && ua < updatedFrom) return false;
      if (updatedTo && ua && ua > updatedTo) return false;
      const tags = (m.tags as any) as string[] | undefined;
      if (excludeTags && tags && tags.some(t => excludeTags.has(t))) return false;
      if (includeTags && (!tags || !tags.some(t => includeTags.has(t)))) return false;
      const t = (m as any).type as string | undefined;
      if (excludeTypes && t && excludeTypes.has(t)) return false;
      if (includeTypes && (!t || !includeTypes.has(t))) return false;
      return true;
    }
    for (const m of metas) {
      if (matchesDoc(m)) kSelected.add(m.id);
    }

    // Build closure (selected + ancestors) unless keepOrphans=true (then export all metas)
    if (keepOrphans) {
      for (const m of metas) kClosure.add(m.id);
    } else {
      // ascend parents
      const visited = new Set<string>();
      for (const id of kSelected) {
        let cur: KnowledgeDocMeta | undefined = kMap.get(id);
        while (cur && !visited.has(cur.id)) {
          visited.add(cur.id);
          kClosure.add(cur.id);
          const pid = (cur as any).parentId || null;
          if (pid) cur = kMap.get(pid); else break;
        }
      }
    }

    // Deterministic order
    for (const arr of kChildren.values()) arr.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled';
  const typeFolder = (t?: string) => {
    if (!t) return 'General';
    const map: Record<string, string> = {
      component: 'Components',
      api: 'API',
      schemas: 'Schemas',
      routes: 'Routes',
      overview: 'Overview',
    };
    return map[t] || sanitize(t);
  };

  async function writeKnowledgeRec(id: string, ancestors: KnowledgeDocMeta[]) {
    if (!kClosure.has(id)) return;
    const meta = kMap.get(id);
    if (!meta) return;
    const doc = await readDoc(meta.project, meta.id);
    if (!doc) return;
    const allKids = kChildren.get(id) || [];
    const kids = allKids.filter(k => kClosure.has(k.id));
    // Base path by type and ancestors
    const baseSegments: string[] = [knowledgeDir, typeFolder((doc as any).type)];
    for (const a of ancestors) baseSegments.push(sanitize(a.title));
    let dir = path.join(...baseSegments);
    let outPath: string;
    const structuralOnly = !kSelected.has(id);
    // If has children (in closure) OR structuralOnly: create folder with current title and write INDEX.md inside
    if (kids.length > 0 || structuralOnly) {
      dir = path.join(dir, sanitize(doc.title));
      await ensureDir(dir);
      outPath = path.join(dir, 'INDEX.md');
    } else {
      // Leaf selected: write a single markdown file in the base dir
      await ensureDir(dir);
      outPath = path.join(dir, `${sanitize(doc.title)}.md`);
    }
    const fm = toFrontmatter({ id: doc.id, project: doc.project, title: doc.title, tags: doc.tags, source: doc.source, updatedAt: doc.updatedAt, parentId: (doc as any).parentId, type: (doc as any).type, structuralOnly: structuralOnly || undefined });
    const body = structuralOnly ? `${fm}\n` : `${fm}\n\n${doc.content || ''}`;
    await writeText(outPath, body);
    knowledgeCount++;
    for (const k of kids) await writeKnowledgeRec(k.id, [...ancestors, meta]);
  }

  // Start from roots (parentId == null or missing)
  if (doKnowledge) {
    const roots = kChildren.get(null) || [];
    for (const r of roots) {
      await writeKnowledgeRec(r.id, []);
    }
  }

  // --- Export tasks: hierarchical by parentId with filters ---
  let tasksCount = 0;
  const taskTrees = doTasks ? await listTasksTree({ project, includeArchived }) : [];
  const sanitizeTitle = (s: string) => s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled';
  // Build parent map and selection/closure
  const tParent = new Map<string, string | null>();
  const tNodes = new Map<string, any>();
  const tSelected = new Set<string>();
  const tClosure = new Set<string>();
  function walkBuild(node: any, parentId: string | null) {
    tParent.set(node.id, parentId);
    tNodes.set(node.id, node);
    const kids = node.children || [];
    for (const ch of kids) walkBuild(ch, node.id);
  }
  if (doTasks) {
    for (const root of taskTrees) walkBuild(root, null);
    function matchesTask(n: any): boolean {
      if (includeStatus && !includeStatus.has(n.status)) return false;
      if (includePriority && !includePriority.has(n.priority)) return false;
      const tags = (n.tags as string[] | undefined) || [];
      if (excludeTags && tags.some(t => excludeTags.has(t))) return false;
      if (includeTags && !tags.some(t => includeTags.has(t))) return false;
      const ua = n.updatedAt ? new Date(n.updatedAt) : undefined;
      if (updatedFrom && ua && ua < updatedFrom) return false;
      if (updatedTo && ua && ua > updatedTo) return false;
      return true;
    }
    for (const [id, node] of tNodes) {
      if (matchesTask(node)) tSelected.add(id);
    }
    if (keepOrphans) {
      for (const id of tNodes.keys()) tClosure.add(id);
    } else {
      const visited = new Set<string>();
      for (const id of tSelected) {
        let curId: string | null | undefined = id;
        while (curId && !visited.has(curId)) {
          visited.add(curId);
          tClosure.add(curId);
          curId = tParent.get(curId) ?? null;
        }
      }
    }
  }

  async function writeTaskNode(node: any, ancestors: string[]) {
    if (!tClosure.has(node.id)) return;
    const childrenAll = node.children || [];
    const children = childrenAll
      .filter((ch: any) => tClosure.has(ch.id))
      // deterministic order: updatedAt desc, then title asc
      .sort((a: any, b: any) => (String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) || String(a.title || '').localeCompare(String(b.title || '')));
    const structuralOnly = !tSelected.has(node.id);
    const fm = toFrontmatter({ id: node.id, project: node.project, status: node.status, priority: node.priority, tags: node.tags, links: node.links, updatedAt: node.updatedAt, parentId: node.parentId, structuralOnly: structuralOnly || undefined });
    const body = structuralOnly ? [fm, '', `# ${node.title}`].join('\n') : [fm, '', `# ${node.title}`, '', (node.description || '')].join('\n');
    if (children.length > 0 || structuralOnly) {
      // Parent/structural: create folder named after node and write INDEX.md inside
      const dir = path.join(tasksDir, ...ancestors.map(sanitizeTitle), sanitizeTitle(node.title));
      await ensureDir(dir);
      const outPath = path.join(dir, 'INDEX.md');
      await writeText(outPath, body);
      tasksCount++;
      for (const ch of children) {
        await writeTaskNode(ch, [...ancestors, node.title]);
      }
    } else {
      // Leaf selected: write a single markdown file within ancestors' directory
      const dir = path.join(tasksDir, ...ancestors.map(sanitizeTitle));
      await ensureDir(dir);
      const outPath = path.join(dir, `${sanitizeTitle(node.title)}.md`);
      await writeText(outPath, body);
      tasksCount++;
    }
  }

  if (doTasks) {
    const roots = [...taskTrees]
      // deterministic order: updatedAt desc, then title asc
      .sort((a: any, b: any) => (String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))) || String(a.title || '').localeCompare(String(b.title || '')));
    for (const root of roots) {
      await writeTaskNode(root, []);
    }
  }

  // --- Export prompts: catalog, builds, and optionally sources ---
  let promptsCount = 0;
  if (doPrompts) {
    const srcBase = path.join(PROMPTS_DIR, project || 'mcp');
    const srcCatalog = path.join(srcBase, 'exports', 'catalog', 'prompts.catalog.json');
    const srcBuilds = path.join(srcBase, 'exports', 'builds');
    const srcMd = path.join(srcBase, 'exports', 'markdown');
    const srcJsonRoots = [path.join(srcBase, 'prompts'), path.join(srcBase, 'rules'), path.join(srcBase, 'workflows'), path.join(srcBase, 'templates'), path.join(srcBase, 'policies')];
    const dstCatalogDir = path.join(promptsDir, 'catalog');
    const dstBuildsDir = path.join(promptsDir, 'builds');
    const dstMdDir = path.join(promptsDir, 'markdown');
    const dstSourcesDir = path.join(promptsDir, 'sources');
    // catalog
    try {
      await ensureDir(dstCatalogDir);
      const raw = await fs.readFile(srcCatalog, 'utf8');
      await fs.writeFile(path.join(dstCatalogDir, 'prompts.catalog.json'), raw, 'utf8');
      const man = JSON.parse(raw);
      promptsCount = man && man.items ? Object.keys(man.items).length : promptsCount;
    } catch {}
    // builds
    try {
      await ensureDir(dstBuildsDir);
      const items = await fs.readdir(srcBuilds, { withFileTypes: true });
      for (const e of items) {
        if (e.isFile() && e.name.endsWith('.json')) {
          const b = await fs.readFile(path.join(srcBuilds, e.name));
          await fs.writeFile(path.join(dstBuildsDir, e.name), b);
        }
        if (e.isFile() && e.name.endsWith('.md')) {
          const b = await fs.readFile(path.join(srcBuilds, e.name));
          await fs.writeFile(path.join(dstBuildsDir, e.name), b);
        }
      }
    } catch {}
    // optional sources markdown
    if (opts?.includePromptSourcesMd) {
      try {
        await ensureDir(dstMdDir);
        const items = await fs.readdir(srcMd, { withFileTypes: true });
        for (const e of items) {
          if (e.isFile() && e.name.endsWith('.md')) {
            const b = await fs.readFile(path.join(srcMd, e.name));
            await fs.writeFile(path.join(dstMdDir, e.name), b);
          }
        }
      } catch {}
    }
    // optional sources json
    if (opts?.includePromptSourcesJson) {
      for (const root of srcJsonRoots) {
        try {
          const rel = path.basename(root);
          const dst = path.join(dstSourcesDir, rel);
          await ensureDir(dst);
          const stack: string[] = [root];
          while (stack.length) {
            const cur = stack.pop()!;
            let entries: any[] = [];
            try { entries = await fs.readdir(cur, { withFileTypes: true }); } catch { continue; }
            for (const ent of entries) {
              const full = path.join(cur, ent.name);
              const relPath = path.relative(root, full);
              const outPath = path.join(dst, relPath);
              if (ent.isDirectory()) {
                await ensureDir(outPath);
                stack.push(full);
              } else if (ent.isFile() && ent.name.endsWith('.json')) {
                const b = await fs.readFile(full);
                await ensureDir(path.dirname(outPath));
                await fs.writeFile(outPath, b);
              }
            }
          }
        } catch {}
      }
    }
  }

  // Optionally, write an index file
  const indexPath = path.join(projectRoot, 'INDEX.md');
  const indexBody = [
    `# Project ${project ?? '(all)'} Export`,
    '',
    `Knowledge: ${knowledgeCount}`,
    `Tasks: ${tasksCount}`,
    doPrompts ? `Prompts: ${promptsCount}` : undefined,
    '',
    `Strategy: ${strategy}`,
  ].filter(Boolean).join('\n');
  await writeText(indexPath, indexBody);

  return { project, vaultRoot, knowledgeCount, tasksCount, promptsCount };
}
