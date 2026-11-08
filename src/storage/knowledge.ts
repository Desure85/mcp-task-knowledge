import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE_DIR, TASKS_DIR } from '../config.js';
import { ensureDir, pathExists, readText, resolveUnder, withFileLock, writeText } from '../fs.js';
import type { KnowledgeDoc, KnowledgeDocMeta, TrustLevel } from '../types.js';
import { promises as fsp } from 'node:fs';
import { emitKnowledgeChanged } from './knowledge-events.js';
import {
  buildDocRow,
  ensureProjectIndexed,
  getActiveMetadataIndex,
  indexDocDelete,
  indexDocWrite,
  noteFilePageRead,
  noteIndexPageRead,
  resolveProjectIndexDirs,
} from './metadata-index.js';
import { mapLimit } from '../utils/concurrency.js';
import { blankToUndefined } from '../utils/strings.js';
import { decodeKeyCursor } from '../utils/pagination.js';
import { childLogger } from '../core/logger.js';

const log = childLogger('storage:knowledge');

function fileFor(project: string, id: string) {
  return resolveUnder(KNOWLEDGE_DIR, project, `${id}.md`);
}

// Centralized resolver for knowledge doc file paths (modern first, then legacy)
function resolveDocFilePaths(project: string, id: string): string[] {
  const modern = fileFor(project, id);
  const legacy = resolveUnder(KNOWLEDGE_DIR, `${id}.md`);
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
  trustLevel?: TrustLevel;
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
    parentId: blankToUndefined(input.parentId),
    type: input.type,
    trustLevel: input.trustLevel ?? 'user',
    archived: false,
    trashed: false,
  };
  const body = matter.stringify(input.content, cleanMeta(data) as any);
  const p = fileFor(input.project, id);
  await ensureDir(path.dirname(p));
  await writeText(p, body);
  await indexDocWrite(input.project, data, p);
  emitKnowledgeChanged(input.project, 'created', id);
  return { ...data, content: input.content };
}

export async function listDocs(filter?: { project?: string; tag?: string; includeArchived?: boolean; includeTrashed?: boolean }): Promise<KnowledgeDocMeta[]> {
  const projects = filter?.project ? [filter.project] : await listAllProjects();
  const metas: KnowledgeDocMeta[] = [];
  for (const project of projects) {
    // Prefer modern layout: KNOWLEDGE_DIR/<project>/
    let dir = resolveUnder(KNOWLEDGE_DIR, project);
    if (!(await pathExists(dir))) {
      // Legacy flat layout fallback: KNOWLEDGE_DIR/* without per-project subdir
      if (await pathExists(KNOWLEDGE_DIR)) {
        dir = KNOWLEDGE_DIR;
      } else {
        continue;
      }
    }
    const files = await fg('*.md', { cwd: dir, dot: false });
    // Parallel read+parse: YAML parsing 100k frontmatters serially cost 11.6 s (§3.1).
    const parsed = await mapLimit(files, 32, async (f) => {
      const raw = await readText(path.join(dir, f));
      return { f, fm: matter(raw) };
    });
    for (const { f, fm } of parsed) {
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

async function resolveKnowledgeDir(project: string): Promise<string | null> {
  const modern = resolveUnder(KNOWLEDGE_DIR, project);
  if (await pathExists(modern)) return modern;
  if (await pathExists(KNOWLEDGE_DIR)) return KNOWLEDGE_DIR;
  return null;
}

interface DocFileEntry {
  id: string;
  file: string;
  mtimeMs: number;
}

/** Файлы документов, отсортированные по (mtime desc, id asc) — без разбора frontmatter. */
export async function listDocEntries(project: string): Promise<DocFileEntry[]> {
  const dir = await resolveKnowledgeDir(project);
  if (!dir) return [];
  const files = await fg('*.md', { cwd: dir, dot: false });
  const entries = await mapLimit(files, 256, async (f) => {
    const file = path.join(dir, f);
    const st = await fsp.stat(file);
    return { id: f.slice(0, -'.md'.length), file, mtimeMs: st.mtimeMs };
  });
  entries.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries;
}

export interface DocPageOptions {
  limit: number;
  cursor?: string | null;
  tag?: string;
  type?: string;
  parentId?: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
  countOnly?: boolean;
}

export interface DocPage {
  items: KnowledgeDocMeta[];
  keys: string[];
  total: number;
  totalExact: boolean;
  hasMore: boolean;
}

function docPasses(meta: KnowledgeDocMeta, opts: DocPageOptions): boolean {
  if (!opts.includeTrashed && (meta as any).trashed) return false;
  if (!opts.includeArchived && (meta as any).archived) return false;
  if (opts.tag && !(meta.tags || []).includes(opts.tag)) return false;
  if (opts.type && meta.type !== opts.type) return false;
  if (opts.parentId && meta.parentId !== opts.parentId) return false;
  return true;
}

async function readDocMetaAt(project: string, entry: DocFileEntry): Promise<KnowledgeDocMeta> {
  const raw = await readText(entry.file);
  const fm = matter(raw);
  const meta = fm.data as any as KnowledgeDocMeta;
  if (!meta) return { id: entry.id, project, title: entry.id, createdAt: '', updatedAt: '' } as KnowledgeDocMeta;
  if (!meta.id) (meta as any).id = entry.id;
  if (!(meta as any).project) (meta as any).project = project;
  return meta;
}

/**
 * Индекс первого элемента строго после курсора (mtime desc, id asc).
 *
 * `id` — id из payload (`pageFromStorage` кодирует `idOf(item)`), поэтому функцию
 * можно применять и к отфильтрованному списку, а не только к файлам каталога.
 */
function startIndexAfterCursor(
  entries: Array<{ id: string; mtimeMs: number }>,
  cursor?: string | null,
): number {
  if (!cursor) return 0;
  const decoded = decodeKeyCursor(cursor);
  const key = Number(decoded.k);
  const index = entries.findIndex((e) => e.mtimeMs < key || (e.mtimeMs === key && e.id > decoded.id));
  return index < 0 ? entries.length : index;
}

/**
 * Страница документов без чтения всего каталога (SC-01). Семантика `total`/`totalExact`
 * та же, что у `listTasksPage`: быстрый путь считает файлы, содержательные фильтры
 * требуют полного разбора frontmatter.
 */
/**
 * SC-02c: index-backed document page. `null` means "not proven complete / no
 * index / index error" and the caller keeps the file path; the page itself
 * reads only its own files and re-upserts rows whose mtime drifted.
 */
async function tryIndexedDocsPage(project: string, opts: DocPageOptions): Promise<DocPage | null> {
  const index = getActiveMetadataIndex();
  if (!index) return null;

  const cursor = opts.cursor ? decodeKeyCursor(opts.cursor) : null;
  const after = cursor ? { mtimeMs: Number(cursor.k), id: cursor.id } : undefined;
  if (after && !Number.isFinite(after.mtimeMs)) return null;

  try {
    if (!index.isProjectComplete(project)) {
      const dirs = await resolveProjectIndexDirs(project, { tasksDir: TASKS_DIR, knowledgeDir: KNOWLEDGE_DIR });
      ensureProjectIndexed(project, dirs);
      return null;
    }

    const result = index.listDocs({
      project,
      limit: opts.countOnly ? undefined : opts.limit,
      type: opts.type,
      parentId: opts.parentId,
      tag: opts.tag,
      excludeArchived: !opts.includeArchived,
      excludeTrashed: !opts.includeTrashed,
      after,
      countOnly: opts.countOnly,
    });

    if (opts.countOnly) {
      return { items: [], keys: [], total: result.total, totalExact: true, hasMore: false };
    }

    const items: KnowledgeDocMeta[] = [];
    const keys: string[] = [];
    let healedOut = 0;

    for (const row of result.items) {
      const file = path.resolve(index.dataDir, row.relPath);
      try {
        const entry = { id: row.id, file, mtimeMs: row.mtimeMs };
        const [meta, st] = await Promise.all([readDocMetaAt(project, entry), fsp.stat(file)]);
        if (st.mtimeMs !== row.mtimeMs) {
          index.upsertDoc(buildDocRow(project, meta, st.mtimeMs, row.relPath));
          if (!docPasses(meta, opts)) {
            healedOut++;
            continue;
          }
          items.push(meta);
          keys.push(String(st.mtimeMs));
          continue;
        }
        items.push(meta);
        keys.push(String(row.mtimeMs));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        index.deleteDoc(row.id);
        healedOut++;
      }
    }

    if (healedOut > 0) index.recountProject(project);

    return {
      items,
      keys,
      total: Math.max(0, result.total - healedOut),
      totalExact: true,
      hasMore: result.hasMore,
    };
  } catch (err) {
    log.warn({ err, project }, 'metadata index page read failed — falling back to the file path');
    return null;
  }
}

export async function listDocsPage(project: string, opts: DocPageOptions): Promise<DocPage> {
  const indexed = await tryIndexedDocsPage(project, opts);
  if (indexed) {
    noteIndexPageRead();
    return indexed;
  }
  noteFilePageRead();

  const entries = await listDocEntries(project);
  const hasContentFilter = Boolean(opts.tag || opts.type || opts.parentId);
  const entriesStart = startIndexAfterCursor(entries, opts.cursor);

  if (opts.countOnly || hasContentFilter) {
    const metas = await mapLimit(entries, 32, (e) => readDocMetaAt(project, e));
    const matched: Array<{ meta: KnowledgeDocMeta; id: string; mtimeMs: number }> = [];
    for (let i = 0; i < metas.length; i++) {
      if (docPasses(metas[i], opts)) matched.push({ meta: metas[i], id: metas[i].id, mtimeMs: entries[i].mtimeMs });
    }
    if (opts.countOnly) {
      return { items: [], keys: [], total: matched.length, totalExact: true, hasMore: false };
    }
    const start = hasContentFilter ? startIndexAfterCursor(matched, opts.cursor) : entriesStart;
    const sliced = matched.slice(start, start + opts.limit);
    return {
      items: sliced.map((m) => m.meta),
      keys: sliced.map((m) => String(m.mtimeMs)),
      total: matched.length,
      totalExact: true,
      hasMore: start + sliced.length < matched.length,
    };
  }

  const collected: KnowledgeDocMeta[] = [];
  const collectedKeys: string[] = [];
  let index = entriesStart;
  const chunkSize = Math.max(32, opts.limit * 2);
  while (collected.length <= opts.limit && index < entries.length) {
    const chunk = entries.slice(index, index + chunkSize);
    const metas = await mapLimit(chunk, 32, (e) => readDocMetaAt(project, e));
    for (let i = 0; i < metas.length; i++) {
      if (!docPasses(metas[i], opts)) continue;
      collected.push(metas[i]);
      collectedKeys.push(String(chunk[i].mtimeMs));
      if (collected.length > opts.limit) break;
    }
    index += chunk.length;
  }
  return {
    items: collected.slice(0, opts.limit),
    keys: collectedKeys.slice(0, opts.limit),
    total: entries.length,
    totalExact: false,
    hasMore: collected.length > opts.limit,
  };
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
  return withFileLock(`doc:${project}/${id}`, () => updateDocUnlocked(project, id, patch));
}

async function updateDocUnlocked(project: string, id: string, patch: Partial<Omit<KnowledgeDoc, 'id' | 'project' | 'createdAt'>>): Promise<KnowledgeDoc | null> {
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
  const snapshotDir = resolveUnder(KNOWLEDGE_DIR, project, '.versions', id);
  await ensureDir(snapshotDir);
  await writeText(
    path.join(snapshotDir, `${currentVersion}-${Date.now()}.md`),
    matter.stringify(existing.content, cleanMeta(existing) as any),
  );

  // AC-01: `parentId: ''` means "detach", exactly like `null` — never written as a value.
  const normalizedPatch: typeof patch =
    'parentId' in patch
      ? { ...patch, parentId: blankToUndefined(patch.parentId as string | undefined) }
      : patch;

  const updatedMeta: KnowledgeDocMeta = {
    ...existing,
    ...normalizedPatch,
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
  await indexDocWrite(project, updatedMeta, p);
  emitKnowledgeChanged(project, 'updated', id);
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
  if (!(await pathExists(p))) {
    indexDocDelete(id);
    return false;
  }
  await fsp.unlink(p);
  indexDocDelete(id);
  emitKnowledgeChanged(project, 'deleted', id);
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
  const snapshotDir = resolveUnder(KNOWLEDGE_DIR, project, '.versions', id);
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
