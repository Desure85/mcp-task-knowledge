/**
 * Z-05 — prompt/skill source layer.
 *
 * A source is a read-only catalog of prompts/skills that can be searched,
 * previewed and imported into a local directory. The first two implementations
 * are a local Claude Code marketplace and a GitHub repository (API tree +
 * raw files). Network and filesystem access are injectable so tests stay
 * hermetic.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface PromptSourceItem {
  /** Stable id within the source (used by preview/import). */
  id: string;
  title: string;
  description?: string;
  version?: string;
  tags?: string[];
  kind?: 'prompt' | 'skill' | 'workflow' | 'rule' | 'template' | 'policy';
  /** Relative path inside the source, when it has one. */
  path?: string;
  /** Canonical upstream URL, when the source has one. */
  url?: string;
  /** SPDX-ish license string declared by the source, when known. */
  license?: string;
}

export interface PromptSourcePreview extends PromptSourceItem {
  content: string;
  bytes: number;
}

export interface PromptImportResult {
  sourceId: string;
  itemId: string;
  path: string;
  bytes: number;
}

export interface PromptImportOptions {
  overwrite?: boolean;
}

export interface PromptSource {
  readonly id: string;
  readonly name: string;
  list(query?: string): Promise<PromptSourceItem[]>;
  preview(id: string): Promise<PromptSourcePreview>;
  import(id: string, targetDir: string, options?: PromptImportOptions): Promise<PromptImportResult>;
}

export type PromptSourceErrorCode = 'NOT_FOUND' | 'INVALID_SOURCE' | 'PATH_ESCAPE' | 'TOO_LARGE';

export class PromptSourceError extends Error {
  readonly code: PromptSourceErrorCode;
  constructor(code: PromptSourceErrorCode, message: string) {
    super(message);
    this.name = 'PromptSourceError';
    this.code = code;
  }
}

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

function assertInside(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PromptSourceError('PATH_ESCAPE', `path escapes source root: ${target}`);
  }
}

function safeId(id: string): string {
  const cleaned = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '');
  if (!cleaned || cleaned.includes('\0')) throw new PromptSourceError('INVALID_SOURCE', 'invalid source id');
  return cleaned;
}

function kindOf(file: string): PromptSourceItem['kind'] {
  const lower = file.toLowerCase();
  if (lower.includes('/skills/') || lower.endsWith('/skill.md') || lower.endsWith('skill.md')) return 'skill';
  if (lower.includes('/rules/')) return 'rule';
  if (lower.includes('/workflows/')) return 'workflow';
  if (lower.includes('/templates/')) return 'template';
  if (lower.includes('/policies/')) return 'policy';
  return 'prompt';
}

function titleOf(file: string): string {
  return path.basename(file).replace(/\.(md|json|ya?ml)$/i, '').replace(/^skill$/i, path.basename(path.dirname(file)));
}

function matches(item: PromptSourceItem, query: string | undefined): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [item.id, item.title, item.description, ...(item.tags ?? [])].some((value) => (value ?? '').toLowerCase().includes(q));
}

async function readDocument(file: string): Promise<{ content: string; bytes: number }> {
  const stat = await fs.stat(file);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new PromptSourceError('TOO_LARGE', `${file} exceeds ${MAX_DOCUMENT_BYTES} bytes`);
  const content = await fs.readFile(file, 'utf8');
  return { content, bytes: Buffer.byteLength(content, 'utf8') };
}

async function firstDocument(dir: string, name: string): Promise<string | null> {
  const candidates = [
    'SKILL.md',
    'PROMPT.md',
    'prompt.md',
    'README.md',
    `${name}.md`,
    `${name}.json`,
  ];
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    try {
      if ((await fs.stat(full)).isFile()) return full;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Local Claude Code marketplace: `.claude-plugin/marketplace.json` or `marketplace.json`. */
export class LocalMarketplaceSource implements PromptSource {
  readonly id = 'marketplace';
  readonly name = 'Local marketplace';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private async manifest(): Promise<{ plugins: Array<{ name?: string; description?: string; version?: string; source?: string }> } | null> {
    for (const candidate of [path.join(this.root, '.claude-plugin', 'marketplace.json'), path.join(this.root, 'marketplace.json')]) {
      try {
        const raw = await fs.readFile(candidate, 'utf8');
        const parsed = JSON.parse(raw) as { plugins?: unknown };
        return { plugins: Array.isArray(parsed.plugins) ? (parsed.plugins as Array<Record<string, string>>) : [] };
      } catch {
        // next location
      }
    }
    return null;
  }

  private async entries(): Promise<Array<PromptSourceItem & { file: string }>> {
    const manifest = await this.manifest();
    const realRoot = await fs.realpath(this.root).catch(() => this.root);
    const out: Array<PromptSourceItem & { file: string }> = [];
    if (manifest) {
      for (const plugin of manifest.plugins) {
        const name = String(plugin.name ?? '').trim();
        if (!name) continue;
        const source = String(plugin.source ?? '').trim();
        let file: string | null = null;
        if (source) {
          const resolved = path.resolve(this.root, source);
          assertInside(this.root, resolved);
          try {
            const real = await fs.realpath(resolved);
            assertInside(realRoot, real);
            const stat = await fs.stat(real);
            file = stat.isDirectory() ? await firstDocument(real, name) : real;
          } catch (error) {
            if (error instanceof PromptSourceError && error.code === 'PATH_ESCAPE') throw error;
            file = null;
          }
        } else {
          file = await firstDocument(path.join(this.root, 'plugins', name), name);
        }
        if (!file) continue;
        out.push({
          id: name,
          title: name,
          description: plugin.description,
          version: plugin.version,
          kind: kindOf(file),
          file,
        });
      }
      if (out.length > 0) return out;
    }
    // No manifest (or no usable plugin): scan markdown/json documents.
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 5) return;
      let list;
      try { list = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of list) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (/\.(md|json)$/i.test(entry.name)) {
          const rel = path.relative(this.root, full).replace(/\\/g, '/');
          out.push({ id: rel, title: titleOf(full), kind: kindOf(rel), path: rel, file: full });
        }
      }
    };
    await walk(this.root, 0);
    return out;
  }

  async list(query?: string): Promise<PromptSourceItem[]> {
    const entries = await this.entries();
    return entries.filter((entry) => matches(entry, query)).map(({ file: _file, ...item }) => item);
  }

  async preview(id: string): Promise<PromptSourcePreview> {
    const wanted = safeId(id);
    const entry = (await this.entries()).find((item) => item.id === wanted);
    if (!entry) throw new PromptSourceError('NOT_FOUND', `prompt not found in marketplace: ${id}`);
    const { content, bytes } = await readDocument(entry.file);
    const { file: _file, ...item } = entry;
    return { ...item, content, bytes };
  }

  async import(id: string, targetDir: string, options: PromptImportOptions = {}): Promise<PromptImportResult> {
    const preview = await this.preview(id);
    const targetRoot = path.resolve(targetDir);
    await fs.mkdir(targetRoot, { recursive: true });
    const ext = path.extname(preview.path ?? preview.id) || (preview.kind === 'skill' ? '.md' : '.json');
    const name = `${path.basename(safeId(preview.id)).replace(/[^a-zA-Z0-9._-]/g, '-')}${ext.startsWith('.') ? ext : `.${ext}`}`;
    const destination = path.join(targetRoot, name);
    assertInside(targetRoot, destination);
    try {
      await fs.writeFile(destination, preview.content, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new PromptSourceError('INVALID_SOURCE', `destination exists: ${destination}`);
      }
      throw error;
    }
    return { sourceId: this.id, itemId: preview.id, path: destination, bytes: preview.bytes };
  }
}

export interface GitHubSourceOptions {
  repo: string;
  ref?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  rawBase?: string;
}

/** GitHub repository source: tree listing + raw file download. */
export class GitHubPromptSource implements PromptSource {
  readonly id = 'github';
  readonly name = 'GitHub repository';
  private readonly repo: string;
  private readonly ref: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly rawBase: string;
  private entriesCache: Array<PromptSourceItem & { path: string }> | null = null;

  constructor(options: GitHubSourceOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repo)) {
      throw new PromptSourceError('INVALID_SOURCE', 'repo must be owner/name');
    }
    this.repo = options.repo;
    this.ref = options.ref ?? 'main';
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
    this.rawBase = (options.rawBase ?? 'https://raw.githubusercontent.com').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return { Accept: 'application/vnd.github+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) };
  }

  private rawUrl(itemPath: string): string {
    return `${this.rawBase}/${this.repo}/${encodeURIComponent(this.ref)}/${itemPath.split('/').map(encodeURIComponent).join('/')}`;
  }

  async list(query?: string): Promise<PromptSourceItem[]> {
    if (!this.entriesCache) {
      const response = await this.fetchImpl(`${this.apiBase}/repos/${this.repo}/git/trees/${encodeURIComponent(this.ref)}?recursive=1`, {
        headers: this.headers(),
      });
      if (!response.ok) throw new PromptSourceError('INVALID_SOURCE', `GitHub tree ${response.status}`);
      const body = (await response.json()) as { tree?: Array<{ path?: string; type?: string }> };
      const entries: Array<PromptSourceItem & { path: string }> = [];
      for (const node of body.tree ?? []) {
        if (node.type !== 'blob' || typeof node.path !== 'string') continue;
        if (!/\.(md|json)$/i.test(node.path)) continue;
        if (!/(^|\/)(prompts|skills|rules|workflows|templates|policies)\//i.test(node.path) && !/(^|\/)SKILL\.md$/i.test(node.path)) continue;
        entries.push({ id: node.path, path: node.path, title: titleOf(node.path), kind: kindOf(node.path), tags: [] });
      }
      this.entriesCache = entries;
    }
    return this.entriesCache.filter((entry) => matches(entry, query)).map(({ path: _path, ...item }) => item);
  }

  async preview(id: string): Promise<PromptSourcePreview> {
    const wanted = safeId(id);
    const entry = (await this.list()).find((item) => item.id === wanted || item.path === wanted);
    if (!entry) {
      // Direct raw path may be requested before list() was called; restrict to the same prefixes.
      if (!/(^|\/)(prompts|skills|rules|workflows|templates|policies)\//i.test(wanted)) {
        throw new PromptSourceError('NOT_FOUND', `prompt not found in GitHub source: ${id}`);
      }
    }
    const itemPath = entry?.path ?? wanted;
    const response = await this.fetchImpl(this.rawUrl(itemPath), { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!response.ok) throw new PromptSourceError('NOT_FOUND', `GitHub raw ${response.status} for ${itemPath}`);
    const content = await response.text();
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_DOCUMENT_BYTES) throw new PromptSourceError('TOO_LARGE', `${itemPath} exceeds ${MAX_DOCUMENT_BYTES} bytes`);
    return {
      ...(entry ?? { id: itemPath, title: titleOf(itemPath), path: itemPath, kind: kindOf(itemPath) }),
      content,
      bytes,
    };
  }

  async import(id: string, targetDir: string, options: PromptImportOptions = {}): Promise<PromptImportResult> {
    const preview = await this.preview(id);
    const targetRoot = path.resolve(targetDir);
    await fs.mkdir(targetRoot, { recursive: true });
    const sourcePath = preview.path ?? preview.id;
    const ext = path.extname(sourcePath) || '.md';
    const name = `${path.basename(safeId(sourcePath)).replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const destination = path.join(targetRoot, name.endsWith(ext) ? name : `${name}${ext}`);
    assertInside(targetRoot, destination);
    try {
      await fs.writeFile(destination, preview.content, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new PromptSourceError('INVALID_SOURCE', `destination exists: ${destination}`);
      }
      throw error;
    }
    return { sourceId: this.id, itemId: preview.id, path: destination, bytes: preview.bytes };
  }
}

/** Z-08: license/provenance report for external prompt/skill catalogs. */
export interface PromptSourceLicenseReport {
  source: string;
  sourceLicense?: string;
  items: Array<{ id: string; title: string; url?: string; license?: string }>;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'item';
}

async function writeImported(
  sourceId: string,
  item: PromptSourceItem,
  content: string,
  targetDir: string,
  options: PromptImportOptions = {},
): Promise<PromptImportResult> {
  const targetRoot = path.resolve(targetDir);
  await fs.mkdir(targetRoot, { recursive: true });
  const destination = path.join(targetRoot, `${slug(item.id)}.md`);
  assertInside(targetRoot, destination);
  try {
    await fs.writeFile(destination, content, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PromptSourceError('INVALID_SOURCE', `destination exists: ${destination}`);
    }
    throw error;
  }
  return { sourceId, itemId: item.id, path: destination, bytes: Buffer.byteLength(content, 'utf8') };
}

function markdownStub(item: PromptSourceItem): string {
  const lines = [`# ${item.title}`, ''];
  if (item.description) lines.push(item.description, '');
  if (item.url) lines.push(`Source: ${item.url}`);
  lines.push(`License: ${item.license ?? 'unknown'}`);
  lines.push(`Kind: ${item.kind ?? 'prompt'}`);
  lines.push('');
  return lines.join('\n');
}

interface RegistryEntry {
  name?: string;
  title?: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
}

/** Z-08: official MCP registry snapshot (`server.json` / `{ servers: [...] }`). */
export class McpRegistrySource implements PromptSource {
  readonly id = 'mcp-registry';
  readonly name = 'MCP registry (local snapshot)';
  private readonly file: string;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  private async entries(): Promise<Array<PromptSourceItem & { file: string }>> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      throw new PromptSourceError('INVALID_SOURCE', `cannot read MCP registry snapshot: ${(error as Error).message}`);
    }
    const raw = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { servers?: unknown }).servers)
        ? (parsed as { servers: unknown[] }).servers
        : [];
    const out: Array<PromptSourceItem & { file: string }> = [];
    for (const entry of raw as RegistryEntry[]) {
      const name = String(entry?.name ?? entry?.title ?? '').trim();
      if (!name) continue;
      const repo = typeof entry.repository === 'string' ? entry.repository : entry.repository?.url;
      out.push({
        id: slug(name),
        title: name,
        description: entry.description,
        license: entry.license,
        url: entry.homepage ?? repo,
        tags: ['registry', 'mcp'],
        kind: 'skill',
        file: name,
      });
    }
    return out;
  }

  async list(query?: string): Promise<PromptSourceItem[]> {
    const entries = (await this.entries()).filter((item) => matches(item, query));
    return entries.map(({ file: _file, ...item }) => item);
  }

  async preview(id: string): Promise<PromptSourcePreview> {
    const item = (await this.entries()).find((entry) => entry.id === id || entry.file === id);
    if (!item) throw new PromptSourceError('NOT_FOUND', `registry entry not found: ${id}`);
    const content = markdownStub(item);
    return { ...item, content, bytes: Buffer.byteLength(content, 'utf8') };
  }

  async import(id: string, targetDir: string, options: PromptImportOptions = {}): Promise<PromptImportResult> {
    const preview = await this.preview(id);
    return writeImported(this.id, preview, preview.content, targetDir, options);
  }

  async licenseReport(): Promise<PromptSourceLicenseReport> {
    const items = (await this.entries()).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      license: item.license,
    }));
    return { source: this.id, items };
  }
}

/**
 * Z-08: awesome-list Markdown reader. The list is a local clone/snapshot:
 * entries are `- [Title](url) — description`; linked resources are not fetched.
 */
export class AwesomeListSource implements PromptSource {
  readonly id = 'awesome-list';
  readonly name = 'Awesome list (local snapshot)';
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private async readme(): Promise<string> {
    for (const name of ['README.md', 'readme.md', 'awesome.md']) {
      try {
        return await fs.readFile(path.join(this.root, name), 'utf8');
      } catch {
        // try next
      }
    }
    throw new PromptSourceError('INVALID_SOURCE', `no README.md/awesome.md under ${this.root}`);
  }

  private parse(markdown: string): PromptSourceItem[] {
    const items: PromptSourceItem[] = [];
    const seen = new Set<string>();
    const pattern = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+)\)(?:\s*[-–—:]\s*(.*))?$/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) {
      const title = match[1].trim();
      const url = match[2].trim();
      let id = slug(title);
      if (seen.has(id)) {
        let n = 2;
        while (seen.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      seen.add(id);
      items.push({
        id,
        title,
        description: (match[3] ?? '').trim() || undefined,
        url,
        tags: ['awesome'],
        kind: 'skill',
      });
    }
    return items;
  }

  async list(query?: string): Promise<PromptSourceItem[]> {
    return (await this.entries()).filter((item) => matches(item, query));
  }

  async preview(id: string): Promise<PromptSourcePreview> {
    const item = (await this.entries()).find((entry) => entry.id === id);
    if (!item) throw new PromptSourceError('NOT_FOUND', `awesome-list entry not found: ${id}`);
    const content = markdownStub(item);
    return { ...item, content, bytes: Buffer.byteLength(content, 'utf8') };
  }

  async import(id: string, targetDir: string, options: PromptImportOptions = {}): Promise<PromptImportResult> {
    const preview = await this.preview(id);
    return writeImported(this.id, preview, preview.content, targetDir, options);
  }

  private async sourceLicense(): Promise<string | undefined> {
    for (const name of ['LICENSE', 'LICENSE.md', 'COPYING']) {
      try {
        const text = await fs.readFile(path.join(this.root, name), 'utf8');
        return text.split(/\r?\n/).find((line) => line.trim())?.trim();
      } catch {
        // try next
      }
    }
    return undefined;
  }

  private async entries(): Promise<PromptSourceItem[]> {
    const license = await this.sourceLicense();
    return this.parse(await this.readme()).map((item) => ({ ...item, license: item.license ?? license }));
  }

  async licenseReport(): Promise<PromptSourceLicenseReport> {
    const sourceLicense = await this.sourceLicense();
    const items = (await this.entries()).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      license: item.license ?? sourceLicense,
    }));
    return { source: this.id, sourceLicense, items };
  }
}
