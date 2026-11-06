#!/usr/bin/env node
/**
 * audit-tests.mjs — machine pass over the test suite (TR-04).
 *
 * Ranks test files by how weakly they are tied to the code they claim to test.
 * This is a CANDIDATE RANKING, not a verdict: only a mutation experiment can
 * prove that a test does not observe its subject. See
 * docs/audits/TR-04-test-quality-audit.md.
 *
 * Known blind spots (why the ranking is not a verdict):
 *   - imports through variables (`const P = '../config.ts'; import(P)`) are only
 *     seen as "indirect" strings, not resolved imports;
 *   - type-only imports are ignored on purpose (erased at runtime);
 *   - subprocess and HTTP tests are recognised by patterns, so a custom wrapper
 *     can hide them;
 *   - an assert on a hand-built object counts as an assert here.
 *
 * Usage:
 *   node scripts/audit-tests.mjs                 # markdown, top 40
 *   node scripts/audit-tests.mjs --json          # full JSON
 *   node scripts/audit-tests.mjs --root <dir>    # audit another tree (used by tests)
 *   node scripts/audit-tests.mjs --top 100 --min-score 30
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** Directories vitest never discovers tests in (vitest.config.ts exclude + VCS noise). */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'web-ui',
  '.opencode',
  'service-catalog',
  '.git',
  '.tmp-vitest',
  'coverage',
  'data',
]);

/** Same shape as vitest's default include: `**\/*.{test,spec}.?(c|m)[jt]s?(x)`. */
const TEST_FILE_RE = /\.(?:test|spec)\.(?:c|m)?[jt]sx?$/;

const WEAK_MATCHERS = ['toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeInstanceOf'];

/** Production code that a test can legitimately drive. */
const PRODUCTION_KINDS = new Set(['src', 'dist', 'scripts']);

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Module specifiers the file mentions: static import, side-effect import,
 * dynamic import() and require(). Type-only imports are flagged because they
 * disappear at runtime.
 * @param {string} text
 * @returns {{ spec: string, typeOnly: boolean }[]}
 */
function moduleSpecifiers(text) {
  const out = new Map();
  const patterns = [
    /(?:^|[^.\w$])from\s*['"]([^'"]+)['"]/g,
    /(?:^|[^.\w$])import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const spec = m[1];
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const statement = text.slice(lineStart, m.index + m[0].length);
      const typeOnly = /\bimport\s+type\b/.test(statement);
      const prev = out.get(spec);
      out.set(spec, { spec, typeOnly: typeOnly && (prev?.typeOnly ?? true) });
    }
  }
  return [...out.values()];
}

/**
 * Relative path literals used indirectly (e.g. `const P = '../config.ts'`).
 * @param {string} text
 * @returns {string[]}
 */
function pathLiterals(text) {
  const out = new Set();
  const re = /['"]((?:\.{1,2}\/)[^'"\n]+\.(?:ts|tsx|js|mjs|cjs))['"]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

/**
 * Resolve a specifier to a repo-relative path when it points inside the tree.
 * `./x.js` in TypeScript means `./x.ts` on disk, so the extension is retried.
 * @param {string} root
 * @param {string} fromFile
 * @param {string} spec
 * @returns {{ kind: 'src'|'dist'|'tests'|'scripts'|'other'|'package'|'node', rel: string }}
 */
function classifySpecifier(root, fromFile, spec) {
  if (spec.startsWith('node:')) return { kind: 'node', rel: spec };
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { kind: 'package', rel: spec };
  const base = spec.startsWith('/') ? spec : path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx')];
  const found = candidates.find((c) => fs.existsSync(c)) ?? base;
  const rel = path.relative(root, found).split(path.sep).join('/');
  if (rel.startsWith('src/')) return { kind: 'src', rel };
  if (rel.startsWith('dist/')) return { kind: 'dist', rel };
  if (rel.startsWith('tests/')) return { kind: 'tests', rel };
  if (rel.startsWith('scripts/')) return { kind: 'scripts', rel };
  return { kind: 'other', rel };
}

/**
 * Follow local imports (test helpers, barrels) up to a small depth and collect
 * everything the file can reach: kinds plus the union of source text.
 * @param {string} root
 * @param {string} file
 * @returns {{ kinds: Set<string>, text: string, indirectSrc: boolean }}
 */
function reachInfo(root, file) {
  const kinds = new Set();
  const seen = new Set();
  const queue = [{ file, depth: 0 }];
  const texts = [];
  let indirectSrc = false;
  while (queue.length > 0) {
    const { file: current, depth } = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const text = fs.readFileSync(current, 'utf8');
    texts.push(text);
    for (const { spec, typeOnly } of moduleSpecifiers(text)) {
      const resolved = classifySpecifier(root, current, spec);
      if (typeOnly) continue;
      kinds.add(resolved.kind);
      const local = resolved.kind === 'tests' || resolved.kind === 'scripts' || resolved.kind === 'other';
      if (local && depth < 2) {
        const abs = path.resolve(root, resolved.rel);
        if (fs.existsSync(abs) && !seen.has(abs)) queue.push({ file: abs, depth: depth + 1 });
      }
    }
    for (const literal of pathLiterals(text)) {
      if (classifySpecifier(root, current, literal).kind === 'src') indirectSrc = true;
    }
  }
  return { kinds, text: texts.join('\n'), indirectSrc };
}

/**
 * How the file reaches production code.
 * @param {string} text
 * @param {Set<string>} kinds
 * @returns {'direct-src'|'direct-dist'|'direct-scripts'|'subprocess-dist'|'subprocess-scripts'|'http'|'fs-only'|'none'}
 */
function consumptionClass(text, kinds) {
  if (kinds.has('src')) return 'direct-src';
  if (kinds.has('dist')) return 'direct-dist';
  if (kinds.has('scripts')) return 'direct-scripts';

  const spawns =
    /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/.test(text) ||
    /\bpromisify\s*\(\s*(?:execFile|exec|spawn)\s*\)/.test(text) ||
    /\bStdioClientTransport\b/.test(text);
  if (spawns && /dist[\\/]index\.js/.test(text)) return 'subprocess-dist';
  if (
    spawns &&
    (/scripts[\\/][\w.-]+\.(?:mjs|js|cjs)/.test(text) ||
      /\bpath\.join\([\s\S]{0,160}?['"]scripts['"]\s*,\s*['"][^'"]+['"]/.test(text))
  ) {
    return 'subprocess-scripts';
  }
  if (spawns && /(?:src[\\/]index\.ts|tsx\b)/.test(text)) return 'subprocess-src';
  if (/\b(?:fetch|request|axios)\s*\(/.test(text) && /(?:localhost|127\.0\.0\.1|MCP_PORT)/.test(text)) {
    return 'http';
  }
  if (/\b(?:readFile|readFileSync|writeFile|writeFileSync|mkdir|rm|glob)\b/.test(text)) return 'fs-only';
  return 'none';
}


/**
 * Replace string/comment contents with spaces, keeping the original length, so
 * brace and arrow scanning is not fooled by titles like `it('a => b', ...)`.
 * @param {string} text
 * @returns {string}
 */
function maskLiterals(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let prev = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === ch) break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      prev = ch;
      continue;
    }
    // Regex literal: `/` in a position where a value cannot end.
    const regexAllowed =
      prev === '' ||
      '([{,;:=!&|?+-*%~^<>'.includes(prev) ||
      /\b(?:return|typeof|case|in|of|delete|void|new)$/.test(
        out.slice(Math.max(0, i - 12), i).join('').trim(),
      );
    if (ch === '/' && regexAllowed) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        else if (text[j] === '\n') break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      prev = '/';
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out.join('');
}

/**
 * Test cases whose body contains no assertion at all.
 * Heuristic brace scan; strings and comments are not stripped.
 * @param {string} text
 * @returns {{ total: number, assertFree: number }}
 */
function testBlocks(text) {
  const masked = maskLiterals(text);
  const re = /\b(?:it|test)(?:\.(?:each|skip|only|concurrent|todo|fails|sequential))?\s*\(/g;
  let total = 0;
  let assertFree = 0;
  let m;
  while ((m = re.exec(masked)) !== null) {
    total += 1;
    const arrow = masked.indexOf('=>', m.index);
    const fn = masked.indexOf('function', m.index);
    let start = -1;
    if (arrow !== -1 && (fn === -1 || arrow < fn)) {
      const brace = masked.indexOf('{', arrow);
      const paren = masked.indexOf('(', arrow);
      start = brace !== -1 && (paren === -1 || brace < paren) ? brace : -1;
    } else if (fn !== -1) {
      const brace = masked.indexOf('{', fn);
      start = brace === -1 ? -1 : brace;
    }
    if (start === -1) {
      const close = masked.indexOf(')', m.index);
      const tail = text.slice(m.index, close === -1 ? m.index + 200 : close + 1);
      if (!/\b(?:assert|verify|expect)\w*\s*\(/.test(tail)) assertFree += 1;
      continue;
    }
    let depth = 0;
    let end = masked.length;
    for (let i = start; i < masked.length; i += 1) {
      const ch = masked[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = text.slice(start, end);
    if (!/\b(?:assert|verify|expect)\w*\s*\(/.test(body)) assertFree += 1;
  }
  return { total, assertFree };
}

/**
 * Assertions that cannot fail: a literal compared to itself, the same
 * identifier on both sides of toBe/toEqual, or `a === x || a !== x` style
 * disjunctions asserted as `true`.
 * @param {string} text
 * @returns {number}
 */
function tautologyCount(text) {
  let count = 0;
  const literal = /expect\s*\(\s*(true|false|\d+)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*\1\s*\)/g;
  count += (text.match(literal) ?? []).length;
  const sameIdent =
    /expect\s*\(\s*(?!(?:true|false|null|undefined)\b)([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*\1\s*\)/g;
  count += (text.match(sameIdent) ?? []).length;
  // Only the exact complement pattern is a tautology: `x === true || x === false`.
  // A real disjunction such as `x === null || typeof x === 'string'` is not.
  const complement = [
    /expect\s*\(\s*([A-Za-z_$][\w$.]*)\s*===\s*true\s*\|\|\s*\1\s*===\s*false\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/g,
    /expect\s*\(\s*([A-Za-z_$][\w$.]*)\s*===\s*false\s*\|\|\s*\1\s*===\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/g,
  ];
  for (const re of complement) count += (text.match(re) ?? []).length;
  return count;
}

/**
 * @param {string} root
 * @param {string} file
 */
function auditFile(root, file) {
  const reach = reachInfo(root, file);
  const ownText = fs.readFileSync(file, 'utf8');
  const code = maskLiterals(ownText);
  const text = reach.text;
  const rel = path.relative(root, file).split(path.sep).join('/');
  const consumption = consumptionClass(text, reach.kinds);
  const reachesProduction =
    [...reach.kinds].some((k) => PRODUCTION_KINDS.has(k)) ||
    consumption.startsWith('subprocess') ||
    consumption === 'http';

  const mockCalls = (code.match(/\b(?:vi|jest)\.(?:mock|fn|spyOn|doMock)\s*\(/g) ?? []).length;
  // Targets must be read from the raw text (specifiers live in strings); the
  // existence check keeps fixture strings in other tests from counting.
  const mockTargets = [...ownText.matchAll(/\b(?:vi|jest)\.mock\s*\(\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );
  const mockSut = mockTargets.filter((t) => {
    const resolved = classifySpecifier(root, file, t);
    return resolved.kind === 'src' && fs.existsSync(path.resolve(root, resolved.rel));
  }).length;

  const expects = (code.match(/\bexpect\s*\(/g) ?? []).length;
  const weak = WEAK_MATCHERS.reduce(
    (sum, name) => sum + (code.match(new RegExp(`\\.${name}\\s*\\(`, 'g')) ?? []).length,
    0,
  );
  const tautologies = tautologyCount(code);
  const blocks = testBlocks(ownText);
  const weakRatio = expects === 0 ? 0 : Number((weak / expects).toFixed(2));

  let score = 0;
  const reasons = [];
  if (!reachesProduction) {
    score += 50;
    reasons.push('no production code reached');
  }
  if (reach.indirectSrc && !reach.kinds.has('src')) {
    score -= 15;
    reasons.push('reaches src only through a variable import');
  }
  if (mockSut > 0) {
    score += 40;
    reasons.push(`mocks its own subject (${mockSut})`);
  }
  if (tautologies > 0) {
    score += 30 + Math.min(tautologies, 5) * 2;
    reasons.push(`tautological asserts (${tautologies})`);
  }
  if (expects === 0) {
    score += 25;
    reasons.push('no expect()');
  }
  if (blocks.assertFree > 0) {
    score += Math.min(blocks.assertFree * 5, 20);
    reasons.push(`assert-free tests (${blocks.assertFree}/${blocks.total})`);
  }
  if (weakRatio > 0.8 && expects >= 4) {
    score += 15;
    reasons.push(`shape-only asserts (${Math.round(weakRatio * 100)}%)`);
  }

  let verdict = 'OK';
  if (tautologies > 0) verdict = 'TAUTOLOGY';
  else if (mockSut > 0) verdict = 'MOCK-SUT';
  else if (!reachesProduction) verdict = 'NO-SUT';
  else if (expects === 0 || blocks.assertFree > 0) verdict = 'NO-ASSERT';
  else if (weakRatio > 0.8 && expects >= 4) verdict = 'WEAK-SHAPE';
  else if (consumption.startsWith('subprocess') || consumption === 'http') verdict = 'E2E';

  return {
    file: rel,
    consumption,
    indirectSrc: reach.indirectSrc,
    importsSrc: moduleSpecifiers(ownText).filter(
      (m) => !m.typeOnly && classifySpecifier(root, file, m.spec).kind === 'src',
    ).length,
    importsDist: moduleSpecifiers(ownText).filter(
      (m) => classifySpecifier(root, file, m.spec).kind === 'dist',
    ).length,
    mockCalls,
    mockSut,
    tests: blocks.total,
    expects,
    weak,
    weakRatio,
    tautologies,
    assertFreeTests: blocks.assertFree,
    score: Math.max(score, 0),
    verdict,
    reasons,
  };
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = { root: REPO_ROOT, json: false, top: 40, minScore: 0, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--root') opts.root = path.resolve(argv[(i += 1)]);
    else if (arg === '--top') opts.top = Number(argv[(i += 1)]);
    else if (arg === '--min-score') opts.minScore = Number(argv[(i += 1)]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

/**
 * @param {string[]} argv
 */
export function audit(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    return { help: 'usage: audit-tests.mjs [--json] [--root DIR] [--top N] [--min-score N]' };
  }
  const files = walk(opts.root).sort();
  const records = files.map((f) => auditFile(opts.root, f));
  const summary = {};
  for (const r of records) summary[r.verdict] = (summary[r.verdict] ?? 0) + 1;
  const ranked = [...records].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return {
    root: opts.root,
    totalFiles: records.length,
    summary,
    ranked: ranked.filter((r) => r.score >= opts.minScore).slice(0, opts.top),
    all: records,
  };
}

/**
 * @param {ReturnType<typeof audit>} report
 */
function toMarkdown(report) {
  const lines = [
    '# Test audit (machine pass)',
    '',
    `Files discovered: **${report.totalFiles}**`,
    '',
    '| Verdict | Files |',
    '|---|---|',
    ...Object.entries(report.summary)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| Score | File | Verdict | Reach | tests | expect | weak% | taut | assert-free | why |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of report.ranked) {
    lines.push(
      `| ${r.score} | ${r.file} | ${r.verdict} | ${r.consumption} | ${r.tests} | ${r.expects} | ` +
        `${Math.round(r.weakRatio * 100)} | ${r.tautologies} | ${r.assertFreeTests} | ${r.reasons.join('; ')} |`,
    );
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = audit();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${toMarkdown(report)}\n`);
  }
}

export {
  auditFile,
  maskLiterals,
  classifySpecifier,
  consumptionClass,
  moduleSpecifiers,
  pathLiterals,
  reachInfo,
  tautologyCount,
  testBlocks,
  walk,
};
