/**
 * Guard for suites that spawn the compiled server (dist/index.js).
 *
 * A stale dist fails end-to-end suites with unrelated assertion errors
 * (2026-11-05: dist built on 2026-10-20 -> 34 red tests in pagination, project
 * statuses, transitions and security suites). Detect it up front and throw an
 * actionable message; build once when dist is missing (fresh worktree, CI job
 * without a prior build).
 *
 * tsc is non-incremental in this project, so every build rewrites dist/index.js:
 * comparing its mtime with the newest src/**\/*.ts mtime is an exact check.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const SRC_DIR = path.join(ROOT, 'src');
const BUILD_LOCK_DIR = path.join(ROOT, '.tmp-dist-build-lock');
const BUILD_LOCK_TIMEOUT_MS = 300_000;

let verified = false;

function listTsFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, files);
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function newestOf(files: string[]): { file: string; mtimeMs: number } | undefined {
  let newest: { file: string; mtimeMs: number } | undefined;
  for (const file of files) {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
  }
  return newest;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Parallel vitest workers must not run tsc over the same outDir at once. */
function withBuildLock(build: () => void): void {
  const deadline = Date.now() + BUILD_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(BUILD_LOCK_DIR);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() > deadline) {
        throw new Error(`[dist-guard] another worker holds ${BUILD_LOCK_DIR} for over 5 minutes`);
      }
      sleepSync(250);
    }
  }
  try {
    build();
  } finally {
    fs.rmSync(BUILD_LOCK_DIR, { recursive: true, force: true });
  }
}

function buildDist(): void {
  process.stderr.write('[dist-guard] dist/index.js отсутствует — собираю: npm run build\n');
  const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    throw new Error(`[dist-guard] npm run build завершился с кодом ${result.status ?? 'signal'}`);
  }
}

export function assertDistFresh(): void {
  if (verified) return;

  if (!fs.existsSync(DIST_ENTRY)) {
    withBuildLock(() => {
      if (!fs.existsSync(DIST_ENTRY)) buildDist();
    });
  }

  const newestSource = newestOf(listTsFiles(SRC_DIR));
  const distMtimeMs = fs.statSync(DIST_ENTRY).mtimeMs;
  if (newestSource && newestSource.mtimeMs > distMtimeMs) {
    throw new Error(
      `[dist-guard] dist устарел: ${path.relative(ROOT, newestSource.file)} изменён ` +
        `${new Date(newestSource.mtimeMs).toISOString()}, dist/index.js собран ` +
        `${new Date(distMtimeMs).toISOString()}. E2E-тесты запускают собранный сервер — ` +
        'выполни `npm run build` и повтори.',
    );
  }
  verified = true;
}
