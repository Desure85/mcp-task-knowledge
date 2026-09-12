#!/usr/bin/env node
// scripts/executable-docs.mjs — DX-24 Executable docs
//
// Extracts fenced code blocks from README.md + docs/**/*.md and validates them:
//   - ```json / ```jsonc          → JSON.parse (catches broken examples)
//   - ```typescript / ```ts       → ts.transpileModule syntax check (not executed)
//   - ```javascript / ```js       → new Function syntax check (not executed)
//   - ```bash / ```sh / ```console → executed ONLY when preceded by
//                                   <!-- doc-test: run --> marker; runs in an
//                                   isolated temp cwd with temp DATA_DIR.
//
// Skip markers (HTML comment on the line directly above the opening fence):
//   <!-- doc-test: skip -->   — skip block entirely (not counted)
//   <!-- doc-test: run -->    — execute bash block (default: skip execution)
//
// Exit code: 0 = all validated blocks pass, 1 = at least one failure.

import { promises as fs } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';

const execFileP = promisify(execFile);
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// --root <dir> overrides the scanned repo root (used by tests to point at a
// temp fixture). Default: the repo containing this script.
const rootArgIdx = process.argv.indexOf('--root');
const REPO_ROOT = rootArgIdx > -1 && process.argv[rootArgIdx + 1]
  ? path.resolve(process.argv[rootArgIdx + 1])
  : path.resolve(__dirname, '..');

const SKIP_RE = /<!--\s*doc-test:\s*skip\s*-->/i;
const RUN_RE = /<!--\s*doc-test:\s*run\s*-->/i;

const EXEC_LANGS = new Set(['bash', 'sh', 'console']);
const JSON_LANGS = new Set(['json', 'jsonc']);
const TS_LANGS = new Set(['typescript', 'ts']);
const JS_LANGS = new Set(['javascript', 'js']);

/** Recursively collect *.md under dir, skipping node_modules/.git/.omo/.session/web-ui. */
function collectMarkdown(rootDir) {
  const out = [];
  const SKIP_DIRS = new Set(['node_modules', '.git', '.omo', '.session', 'web-ui', 'dist', 'service-catalog', 'coverage']);
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(p);
      }
    }
  }
  walk(rootDir);
  return out;
}

/**
 * Extract fenced code blocks with metadata.
 * Returns [{ file, line, lang, code, skip, run }].
 */
function extractBlocks(filePath, content) {
  const lines = content.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^```(\S*)\s*$/);
    if (!m) {
      i++;
      continue;
    }
    const lang = (m[1] || '').toLowerCase();
    const startLine = i + 1; // 1-based
    // Look back up to 2 lines for a marker (allow blank line between marker and fence)
    let skip = false;
    let run = false;
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      const prev = lines[j].trim();
      if (prev === '') continue;
      if (SKIP_RE.test(prev)) skip = true;
      if (RUN_RE.test(prev)) run = true;
      break; // only inspect nearest non-empty line
    }
    // Collect block body
    const body = [];
    i++;
    while (i < lines.length && !/^```\s*$/.test(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    i++; // skip closing fence
    blocks.push({
      file: filePath,
      line: startLine,
      lang,
      code: body.join('\n'),
      skip,
      run,
    });
  }
  return blocks;
}

/** Validate a JSON block. Returns error message or null. */
function validateJson(code) {
  try {
    JSON.parse(code);
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Validate a TypeScript block (syntax only). Returns error message or null. */
function validateTs(code) {
  const res = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: false,
    },
  });
  const diags = (res.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (diags.length === 0) return null;
  return diags
    .slice(0, 3)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
    .join('; ');
}

/** Validate a JavaScript block (syntax only). Returns error message or null. */
function validateJs(code) {
  try {
    // Wrap in async function to allow top-level await in examples
    new Function(`return (async () => { ${code}\n })`);
    return null;
  } catch (e) {
    return e.message;
  }
}

/**
 * Execute a bash block in an isolated temp dir.
 * Each line runs via `bash -c`. Comment-only and empty lines are skipped.
 * Returns { ok, output }.
 */
async function execBash(code, tmpDir) {
  const env = {
    ...process.env,
    DATA_DIR: path.join(tmpDir, 'data'),
    CURRENT_PROJECT: 'doc-test',
    EMBEDDINGS_MODE: 'none',
    OBSIDIAN_VAULT_ROOT: path.join(tmpDir, 'vault'),
    HOME: tmpDir, // isolate ~ expansion
    PATH: process.env.PATH,
  };
  await fs.mkdir(env.DATA_DIR, { recursive: true });
  try {
    const { stdout, stderr } = await execFileP('bash', ['-e', '-o', 'pipefail', '-c', code], {
      cwd: tmpDir,
      env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, output: stdout + stderr };
  } catch (e) {
    return { ok: false, output: (e.stdout || '') + (e.stderr || '') + '\n' + e.message };
  }
}

async function main() {
  const files = [path.join(REPO_ROOT, 'README.md'), ...collectMarkdown(path.join(REPO_ROOT, 'docs'))];
  const results = [];
  let tmpDir;

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, file);
    const blocks = extractBlocks(file, content);
    for (const b of blocks) {
      if (b.skip) {
        results.push({ file: rel, line: b.line, lang: b.lang, status: 'skip', reason: 'marker' });
        continue;
      }
      if (JSON_LANGS.has(b.lang)) {
        const err = validateJson(b.code);
        results.push({ file: rel, line: b.line, lang: b.lang, status: err ? 'fail' : 'pass', error: err });
      } else if (TS_LANGS.has(b.lang)) {
        const err = validateTs(b.code);
        results.push({ file: rel, line: b.line, lang: b.lang, status: err ? 'fail' : 'pass', error: err });
      } else if (JS_LANGS.has(b.lang)) {
        const err = validateJs(b.code);
        results.push({ file: rel, line: b.line, lang: b.lang, status: err ? 'fail' : 'pass', error: err });
      } else if (EXEC_LANGS.has(b.lang)) {
        if (!b.run) {
          results.push({ file: rel, line: b.line, lang: b.lang, status: 'skip', reason: 'no-run-marker' });
          continue;
        }
        if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-test-'));
        const r = await execBash(b.code, tmpDir);
        results.push({
          file: rel,
          line: b.line,
          lang: b.lang,
          status: r.ok ? 'pass' : 'fail',
          error: r.ok ? undefined : r.output.slice(0, 500),
        });
      }
      // other languages: ignored (mermaid, yaml, text, etc.)
    }
  }

  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;

  for (const r of results) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
    const loc = `${r.file}:${r.line}`;
    if (r.status === 'fail') {
      console.log(`${tag} ${loc} [${r.lang}]`);
      console.log(`     ${String(r.error).split('\n').slice(0, 4).join('\n     ')}`);
    } else {
      console.log(`${tag} ${loc} [${r.lang}]${r.reason ? ` (${r.reason})` : ''}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('executable-docs crashed:', e);
  process.exit(1);
});
