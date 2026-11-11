/**
 * U-05 — reusable anchor verification for memory facts.
 *
 * The CLI (`scripts/verify-memory.mjs`) has the full git workflow; this module
 * holds the pure part shared with the MCP tool `memory_verify`: extract anchors,
 * resolve a path against a checkout, check line ranges and classify a fact.
 *
 * Semantic truth ("does the fact still mean the same") stays manual.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type VerifyStatus = 'verified' | 'pending-merge' | 'stale' | 'no-anchor';

export interface FileAnchor {
  kind: 'path';
  file: string;
  from: number | null;
  to: number | null;
  strong: boolean;
}

export interface SymbolAnchor {
  kind: 'symbol';
  className: string;
  method: string;
  strong: true;
}

export type Anchor = FileAnchor | SymbolAnchor;

const PATH_RE = /([\w@.+-]+(?:\/[\w@.+-]+)+\.(?:php|md|json|ya?ml|sh|ts|tsx|js|mjs|sql))(?::(\d+)(?:-(\d+))?)?/g;
const BARE_FILE_RE = /(?<![\w/])([\w@.+-]+\.(?:php|md|json|ya?ml|sh|ts|tsx|js|mjs|sql))(?::(\d+)(?:-(\d+))?)?/g;
const CLASS_RE = /\b([A-Z][A-Za-z0-9_]+)::([a-zA-Z0-9_]+)\b/g;
const TICKET_RE = /\b(?:DEV|BT|AUD|FRONT)-\d+\b/;

/** Extract path and `Class::method` anchors from fact title + content. */
export function anchorsOf(text: string | undefined, repoTops?: Set<string>): Anchor[] {
  const out: Anchor[] = [];
  const seen = new Set<string>();
  const push = (anchor: Anchor) => {
    const key = JSON.stringify(anchor);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(anchor);
  };
  const source = String(text ?? '');
  for (const m of source.matchAll(PATH_RE)) {
    const top = m[1].split('/')[0];
    push({
      kind: 'path',
      file: m[1],
      from: m[2] ? Number(m[2]) : null,
      to: m[3] ? Number(m[3]) : null,
      strong: repoTops ? repoTops.has(top) : true,
    });
  }
  for (const m of source.matchAll(BARE_FILE_RE)) {
    push({
      kind: 'path',
      file: m[1],
      from: m[2] ? Number(m[2]) : null,
      to: m[3] ? Number(m[3]) : null,
      strong: Boolean(m[2]),
    });
  }
  for (const m of source.matchAll(CLASS_RE)) {
    push({ kind: 'symbol', className: m[1], method: m[2], strong: true });
  }
  return out;
}

/** Map every path suffix to tracked files (longest suffix wins). */
export function buildSuffixIndex(files: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i <= Math.min(parts.length, 3); i++) {
      const suffix = parts.slice(-i).join('/');
      const bucket = index.get(suffix) ?? [];
      bucket.push(file);
      index.set(suffix, bucket);
    }
  }
  return index;
}

/** Resolve an anchor file against the git index: exact, then shortest suffix. */
export function resolveRepoPath(file: string, index: Map<string, string[]>, fileSet?: Set<string>): string | undefined {
  const normalized = file.replace(/^\.\//, '');
  if (fileSet?.has(normalized)) return normalized;
  const bucket = index.get(normalized);
  if (!bucket || bucket.length === 0) return undefined;
  if (bucket.length === 1) return bucket[0];
  return bucket.slice().sort((a, b) => a.length - b.length)[0];
}

/** An anchor pointing past EOF means the fact drifted. */
export function lineInRange(from: number | null, to: number | null, lineCount: number): boolean {
  if (!from) return true;
  if (!lineCount) return false;
  if (from > lineCount) return false;
  if (to && to > lineCount) return false;
  return true;
}

export function ticketOf(text: string | undefined): string | null {
  const m = String(text ?? '').match(TICKET_RE);
  return m ? m[0] : null;
}

export function branchesFor(ticket: string | null, branches: string[]): string[] {
  if (!ticket) return [];
  return branches.filter((b) => b === ticket || b.startsWith(`${ticket}-`) || b.startsWith(`${ticket}_`));
}

export interface VerifyIndex {
  files: string[];
  fileSet: Set<string>;
  suffixIndex: Map<string, string[]>;
  repoTops: Set<string>;
  lineCount: (rel: string) => number;
  /** Optional symbol lookup (git grep in the CLI/tool); absent → symbol unknown. */
  symbolExists?: (className: string, method: string) => boolean;
}

export interface VerifyResult {
  status: VerifyStatus;
  anchors: Array<{ anchor: Anchor; status: 'verified' | 'missing' | 'unknown'; rel?: string; reason?: string }>;
}

/** Classify a fact from its anchors. Weak anchors can confirm but never make stale. */
export function verifyAnchors(anchors: Anchor[], index: VerifyIndex): VerifyResult {
  if (anchors.length === 0) return { status: 'no-anchor', anchors: [] };
  const checked: VerifyResult['anchors'] = [];
  let anyStrong = false;
  for (const anchor of anchors) {
    if (anchor.strong) anyStrong = true;
    if (anchor.kind === 'path') {
      const rel = resolveRepoPath(anchor.file, index.suffixIndex, index.fileSet);
      if (!rel) {
        checked.push({ anchor, status: 'missing', reason: 'file not in git index' });
        continue;
      }
      if (!lineInRange(anchor.from, anchor.to, index.lineCount(rel))) {
        checked.push({ anchor, status: 'missing', rel, reason: 'line out of range' });
        continue;
      }
      checked.push({ anchor, status: 'verified', rel });
      continue;
    }
    if (!index.symbolExists) {
      checked.push({ anchor, status: 'unknown', reason: 'symbol lookup not enabled' });
      continue;
    }
    checked.push(
      index.symbolExists(anchor.className, anchor.method)
        ? { anchor, status: 'verified' }
        : { anchor, status: 'missing', reason: 'symbol not found' },
    );
  }
  if (checked.some((entry) => entry.status === 'verified')) return { status: 'verified', anchors: checked };
  if (!anyStrong) return { status: 'no-anchor', anchors: checked };
  return { status: 'stale', anchors: checked };
}

/** Build a verification index for a checkout using the git index. */
export function loadRepoIndex(repo: string): VerifyIndex {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();
  if (path.resolve(top).toLowerCase() !== path.resolve(repo).toLowerCase()) {
    throw new Error(`not a git repository root: ${repo}`);
  }
  const files = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
  const fileSet = new Set(files);
  const suffixIndex = buildSuffixIndex(files);
  const repoTops = new Set(files.map((file) => file.split('/')[0]));
  const lineCounts = new Map<string, number>();
  const lineCount = (rel: string): number => {
    if (lineCounts.has(rel)) return lineCounts.get(rel)!;
    let count = 0;
    try {
      count = fs.readFileSync(path.join(repo, rel), 'utf8').split('\n').length;
    } catch {
      count = 0;
    }
    lineCounts.set(rel, count);
    return count;
  };
  return { files, fileSet, suffixIndex, repoTops, lineCount };
}
