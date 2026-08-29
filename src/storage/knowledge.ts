import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE_DIR } from '../config.js';
import { ensureDir, pathExists, readText, writeText } from '../fs.js';
import type { KnowledgeDoc, KnowledgeDocMeta } from '../types.js';
import { promises as fsp } from 'node:fs';

function fileFor(project: string, id: string) {
  return path.join(KNOWLEDGE_DIR, project, `${id}.md`);
}

// Centralized resolver for knowledge doc file paths (modern first, then legacy)
function resolveDocFilePaths(project: string, id: string): string[] {
  const modern = fileFor(project, id);
  const legacy = path.join(KNOWLEDGE_DIR, `${id}.md`);
  return [modern, legacy];
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
  const id = randomUUID();
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
      // Fallback: ensure project is set based on directory being scanned
      if (!(meta as any).project) {
        (meta as any).project = project;
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
  // Try resolved paths in order
  const [pModern, pLegacy] = resolveDocFilePaths(project, id);
  let p = pModern;
  if (!(await pathExists(pModern))) {
    if (!(await pathExists(pLegacy))) return null;
    p = pLegacy;
  }
  const raw = await readText(p);
  const fm = matter(raw);
  const meta = fm.data as any as KnowledgeDocMeta;
  // gray-matter preserves trailing newline if present; normalize to match original input string comparisons
  const content = fm.content.endsWith('\n') ? fm.content.slice(0, -1) : fm.content;
  // Ensure project is set in meta when reading from legacy path
  const metaProject = (meta as any).project || project;
  return { ...meta, project: metaProject, content } as KnowledgeDoc;
}

export async function updateDoc(project: string, id: string, patch: Partial<Omit<KnowledgeDoc, 'id' | 'project' | 'createdAt'>>): Promise<KnowledgeDoc | null> {
  const existing = await readDoc(project, id);
  if (!existing) return null;
  // Monotonic updatedAt: bump by 1ms when the new timestamp would equal the old
  // (fast successive updates within the same millisecond must still be distinguishable)
  let updatedAt = new Date().toISOString();
  if (updatedAt <= existing.updatedAt) {
    updatedAt = new Date(new Date(existing.updatedAt).getTime() + 1).toISOString();
  }

  // Versioning (TD-005): snapshot the current version before overwriting
  const currentVersion = existing.version ?? 1;
  const historyEntry = { version: currentVersion, updatedAt: existing.updatedAt, title: existing.title };
  const history = [historyEntry, ...(existing.history ?? [])].slice(0, 50);
  const snapshotDir = path.join(KNOWLEDGE_DIR, project, '.versions', id);
  await ensureDir(snapshotDir);
  await writeText(
    path.join(snapshotDir, `${currentVersion}-${Date.now()}.md`),
    matter.stringify(existing.content, cleanMeta(existing) as any),
  );

  const updatedMeta: KnowledgeDocMeta = {
    ...existing,
    ...patch,
    id: existing.id,
    project: existing.project,
    createdAt: existing.createdAt,
    updatedAt,
    version: currentVersion + 1,
    history,
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

// ─── Versioning (TD-005) ───────────────────────────────────────────

/** List saved versions of a doc (metadata only, newest first). */
export async function listDocVersions(project: string, id: string): Promise<Array<{ version: number; updatedAt: string; title?: string }>> {
  const doc = await readDoc(project, id);
  if (!doc) return [];
  return doc.history ?? [];
}

/** Restore a doc to a previous version. Returns the restored doc or null. */
export async function restoreDocVersion(project: string, id: string, version: number): Promise<KnowledgeDoc | null> {
  const doc = await readDoc(project, id);
  if (!doc || !doc.history) return null;
  const target = doc.history.find((h) => h.version === version);
  if (!target) return null;

  // Read the snapshot file for that version (stored as <version>-<ts>.md)
  const snapshotDir = path.join(KNOWLEDGE_DIR, project, '.versions', id);
  const snapshots = await listSnapshotFiles(snapshotDir);
  const matching = snapshots.filter((f) => f.startsWith(`${version}-`)).sort().pop();
  if (!matching) return null;

  const raw = await readText(path.join(snapshotDir, matching));
  const parsed = matter(raw);
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  // Update current doc content + title from the snapshot, bump version
  const restored = await updateDoc(project, id, {
    content,
    title: (parsed.data.title as string | undefined) ?? doc.title,
  } as never);
  return restored;
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  try {
    return (await fsp.readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}
