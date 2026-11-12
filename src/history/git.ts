/**
 * MU-03/SC-07: batched git history for DATA_DIR.
 *
 * Paths are queued durably before callers write, then flushed as one commit when
 * 100 paths or 2 s accumulate. No git binary -> disabled with one warning; the
 * task/knowledge writes themselves are unaffected.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir, withFileLock } from '../fs.js';
import { childLogger } from '../core/logger.js';

const execFile = promisify(execFileCb);
const log = childLogger('history');

export interface GitHistoryOptions {
  root: string;
  author?: string;
  batchSize?: number;
  flushMs?: number;
  gitBin?: string;
}

interface GitResult { code: number; stdout: string; stderr: string }

export class GitHistory {
  readonly root: string;
  readonly queueFile: string;
  private readonly author: string;
  private readonly batchSize: number;
  private readonly flushMs: number;
  private readonly gitBin: string;
  private enabled = false;
  private initialized = false;
  private timer: NodeJS.Timeout | undefined;
  private queue = new Set<string>();
  private flushing: Promise<void> | undefined;

  constructor(options: GitHistoryOptions) {
    this.root = options.root;
    this.queueFile = path.join(this.root, '.history', 'queue.jsonl');
    this.author = options.author ?? 'mcp-task-knowledge <mcp@localhost>';
    this.batchSize = options.batchSize ?? 100;
    this.flushMs = options.flushMs ?? 2000;
    this.gitBin = options.gitBin ?? 'git';
  }

  private async git(args: string[], allowFail = false): Promise<GitResult> {
    try {
      const result = await execFile(this.gitBin, args, { cwd: this.root, windowsHide: true });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      const result = { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
      if (!allowFail) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
      return result;
    }
  }

  async init(): Promise<boolean> {
    if (this.initialized) return this.enabled;
    this.initialized = true;
    try {
      await this.git(['--version']);
    } catch {
      log.warn('git binary not available — history disabled');
      this.enabled = false;
      return false;
    }
    await ensureDir(this.root);
    const top = await this.git(['rev-parse', '--show-toplevel'], true);
    const expected = path.resolve(this.root);
    const actual = top.code === 0 ? path.resolve(top.stdout.trim()) : '';
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      await this.git(['init', '-q']);
      await this.writeIgnore();
      await this.git(['config', 'user.name', 'mcp-task-knowledge']);
      await this.git(['config', 'user.email', 'mcp@localhost']);
      await this.git(['add', '.gitignore']);
      await this.git(['commit', '-q', '-m', 'history: init', `--author=${this.author}`], true);
    }
    await this.writeIgnore();
    await this.recoverDirty();
    this.enabled = true;
    await this.flush();
    return true;
  }

  private async writeIgnore(): Promise<void> {
    const file = path.join(this.root, '.gitignore');
    const needed = ['audit.log', '.jwt-revoked.json', '.backups/', 'memory/', '.history/queue.jsonl', '.tmp-*'];
    const current = await fs.readFile(file, 'utf8').catch(() => '');
    const lines = new Set(current.split(/\r?\n/).filter(Boolean));
    let changed = false;
    for (const line of needed) {
      if (!lines.has(line)) {
        lines.add(line);
        changed = true;
      }
    }
    if (changed) await fs.writeFile(file, `${[...lines].join('\n')}\n`, 'utf8');
  }

  private async recoverDirty(): Promise<void> {
    const status = await this.git(['status', '--porcelain'], true);
    if (status.code !== 0 || !status.stdout.trim()) return;
    await this.git(['add', '-A']);
    await this.git(['commit', '-q', '-m', 'history: recovered', `--author=${this.author}`], true);
  }

  async enqueue(paths: string[]): Promise<void> {
    if (!(await this.init())) return;
    const normalized = paths
      .map((p) => p.replace(/\\/g, '/').replace(/^\.?\//, ''))
      .filter((p) => p && !p.startsWith('..'));
    if (normalized.length === 0) return;
    await ensureDir(path.dirname(this.queueFile));
    await fs.appendFile(this.queueFile, normalized.map((p) => JSON.stringify({ path: p })).join('\n') + '\n', 'utf8');
    for (const p of normalized) this.queue.add(p);
    if (this.queue.size >= this.batchSize) {
      await this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => { void this.flush(); }, this.flushMs);
      this.timer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = withFileLock(`history:${this.root}`, async () => {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      const queued = new Set(this.queue);
      const raw = await fs.readFile(this.queueFile, 'utf8').catch(() => '');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { path?: unknown };
          if (typeof parsed.path === 'string') queued.add(parsed.path);
        } catch { /* torn line */ }
      }
      if (queued.size === 0) return;
      await this.git(['add', '--', ...queued]);
      const staged = await this.git(['diff', '--cached', '--name-only']);
      if (!staged.stdout.trim()) {
        this.queue.clear();
        await fs.writeFile(this.queueFile, '', 'utf8');
        return;
      }
      await this.git(['commit', '-q', '-m', `history: ${queued.size} path(s)`, `--author=${this.author}`]);
      this.queue.clear();
      await fs.writeFile(this.queueFile, '', 'utf8');
    }).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  async log(limit = 20): Promise<string> {
    if (!(await this.init())) return '';
    const result = await this.git(['log', `-${limit}`, '--pretty=format:%h %s']);
    return result.stdout;
  }

  async revert(commit: string): Promise<void> {
    if (!(await this.init())) throw new Error('git history disabled');
    await this.git(['revert', '--no-edit', commit]);
  }

  async close(): Promise<void> {
    await this.flush();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
