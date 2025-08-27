import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { KNOWLEDGE_DIR } from '../config.js';
import { ensureDir, pathExists, readText, writeText } from '../fs.js';
import type { KnowledgeDoc, KnowledgeDocMeta } from '../types.js';
import { promises as fsp } from 'node:fs';

function fileFor(project: string, id: string) {
  return path.join(KNOWLEDGE_DIR, project, `${id}.md`);
}

// Remove undefined values from frontmatter to avoid YAML dump errors
function cleanMeta<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}

export async function createDoc(input: {
  project: string;
  title: string;
  content: string; // markdown
  tags?: string[];
  source?: string;
  parentId?: string;
  type?: string;
}): Promise<KnowledgeDoc> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const data: KnowledgeDocMeta = {
    id,
    project: input.project,
    title: input.title,
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now,
    source: input.source,
    parentId: input.parentId,
    type: input.type,
    archived: false,
    trashed: false,
  };
  const body = matter.stringify(input.content, cleanMeta(data) as any);
  const p = fileFor(input.project, id);
  await ensureDir(path.dirname(p));
  await writeText(p, body);
  return { ...data, content: input.content };
}

export async function listDocs(filter?: { project?: string; tag?: string; includeArchived?: boolean; includeTrashed?: boolean }): Promise<KnowledgeDocMeta[]> {
  const projects = filter?.project ? [filter.project] : await listAllProjects();
  const metas: KnowledgeDocMeta[] = [];
  for (const project of projects) {
    // Prefer modern layout: KNOWLEDGE_DIR/<project>/
    let dir = path.join(KNOWLEDGE_DIR, project);
    if (!(await pathExists(dir))) {
      // Legacy flat layout fallback: KNOWLEDGE_DIR/* without per-project subdir
      if (await pathExists(KNOWLEDGE_DIR)) {
        dir = KNOWLEDGE_DIR;
      } else {
        continue;
      }
    }
    const files = await fg('*.md', { cwd: dir, dot: false });
    for (const f of files) {
      const full = path.join(dir, f);
      const raw = await readText(full);
      const fm = matter(raw);
      const meta = fm.data as any as KnowledgeDocMeta;
      if (!meta) continue;
      // Fallback: if id missing in frontmatter, derive from filename
      if (!meta.id) {
        const base = path.basename(f, path.extname(f));
        (meta as any).id = base;
      }
      // skip trashed by default unless explicitly included
      if (!filter?.includeTrashed && (meta as any).trashed) continue;
      // skip archived by default unless explicitly included
      if (!filter?.includeArchived && (meta as any).archived) continue;
      if (filter?.tag && !(meta.tags || []).includes(filter.tag)) continue;
      metas.push(meta);
    }
  }
  metas.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return metas;
}

export async function readDoc(project: string, id: string): Promise<KnowledgeDoc | null> {
  const p = fileFor(project, id);
  if (!(await pathExists(p))) return null;
  const raw = await readText(p);
  const fm = matter(raw);
  const meta = fm.data as any as KnowledgeDocMeta;
  return { ...meta, content: fm.content };
}

export async function updateDoc(project: string, id: string, patch: Partial<Omit<KnowledgeDoc, 'id' | 'project' | 'createdAt'>>): Promise<KnowledgeDoc | null> {
  const existing = await readDoc(project, id);
  if (!existing) return null;
  const updatedMeta: KnowledgeDocMeta = {
    ...existing,
    ...patch,
    id: existing.id,
    project: existing.project,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const content = patch.content !== undefined ? patch.content : existing.content;
  const body = matter.stringify(content, cleanMeta(updatedMeta) as any);
  const p = fileFor(project, id);
  await writeText(p, body);
  return { ...updatedMeta, content };
}

export async function archiveDoc(project: string, id: string): Promise<KnowledgeDoc | null> {
  return updateDoc(project, id, { archived: true, archivedAt: new Date().toISOString() } as any);
}

export async function trashDoc(project: string, id: string): Promise<KnowledgeDoc | null> {
  return updateDoc(project, id, { trashed: true, trashedAt: new Date().toISOString() } as any);
}

export async function restoreDoc(project: string, id: string): Promise<KnowledgeDoc | null> {
  return updateDoc(project, id, { archived: false, trashed: false } as any);
}

export async function deleteDocPermanent(project: string, id: string): Promise<boolean> {
  const p = fileFor(project, id);
  if (!(await pathExists(p))) return false;
  await fsp.unlink(p);
  return true;
}

async function listAllProjects(): Promise<string[]> {
  const fs = await import('node:fs/promises');
  try {
    const entries = await fs.readdir(KNOWLEDGE_DIR, { withFileTypes: true });
    const projects: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      projects.push(e.name);
    }
    return projects;
  } catch {
    return [];
  }
}
