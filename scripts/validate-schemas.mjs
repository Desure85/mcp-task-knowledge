#!/usr/bin/env node
// scripts/validate-schemas.mjs
// Validate repository artifacts against JSON Schemas
// - tasks JSON against schemas/task.schema.json
// - knowledge frontmatter (Markdown) against schemas/knowledge.schema.json
// - prompts exports: catalog/builds/services/ab-report
// - feedback JSONL rows against schemas/feedback.event.schema.json

import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';
import fg from 'fast-glob';
import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Resolve base data dir similar to scripts/prompts.mjs
const ENV_DATA_DIR = process.env.DATA_DIR ? path.resolve(process.cwd(), process.env.DATA_DIR) : null;
let BASE_DATA_DIR = ENV_DATA_DIR || path.join(REPO_ROOT, '.data');
try {
  if (!ENV_DATA_DIR) await fs.access(BASE_DATA_DIR);
} catch {
  BASE_DATA_DIR = ENV_DATA_DIR || path.join(REPO_ROOT, 'data');
}

// Resolve prompts base dir (project-scoped paths mirror prompts.mjs)
let PROMPTS_BASE_DIR = process.env.MCP_PROMPTS_DIR
  ? path.resolve(process.cwd(), process.env.MCP_PROMPTS_DIR)
  : path.join(BASE_DATA_DIR, 'prompts');
try {
  await fs.access(PROMPTS_BASE_DIR);
} catch {
  const legacy = path.join(BASE_DATA_DIR, 'mcp', 'prompts');
  try {
    await fs.access(legacy);
    PROMPTS_BASE_DIR = legacy;
  } catch {}
}
const CURRENT_PROJECT = process.env.CURRENT_PROJECT || 'mcp';
const PROJECT_PROMPTS_DIR = path.join(PROMPTS_BASE_DIR, CURRENT_PROJECT);
const EXPORTS_DIR = path.join(PROJECT_PROMPTS_DIR, 'exports');
const EXPORTS_CATALOG_DIR = path.join(EXPORTS_DIR, 'catalog');
const EXPORTS_BUILDS_DIR = path.join(EXPORTS_DIR, 'builds');
const EXPERIMENTS_DIR = path.join(PROJECT_PROMPTS_DIR, 'experiments');

// Resolve tasks/knowledge dirs (modern and legacy), allow env overrides like src/config.ts
const MCP_TASK_DIR = process.env.MCP_TASK_DIR
  ? path.resolve(process.cwd(), process.env.MCP_TASK_DIR)
  : path.join(BASE_DATA_DIR, 'tasks');
const MCP_TASK_DIR_LEGACY = path.join(BASE_DATA_DIR, 'mcp', 'tasks');
const TASKS_DIR = (await exists(MCP_TASK_DIR)) ? MCP_TASK_DIR : MCP_TASK_DIR_LEGACY;

const MCP_KNOWLEDGE_DIR = process.env.MCP_KNOWLEDGE_DIR
  ? path.resolve(process.cwd(), process.env.MCP_KNOWLEDGE_DIR)
  : path.join(BASE_DATA_DIR, 'knowledge');
const MCP_KNOWLEDGE_DIR_LEGACY = path.join(BASE_DATA_DIR, 'mcp', 'knowledge');
const KNOWLEDGE_DIR = (await exists(MCP_KNOWLEDGE_DIR)) ? MCP_KNOWLEDGE_DIR : MCP_KNOWLEDGE_DIR_LEGACY;

function rel(p) { return path.relative(REPO_ROOT, p); }

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function loadJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function formatErrors(errs) {
  return (errs || []).map(e => `${e.instancePath || '/'} ${e.message || ''}`.trim());
}

async function validateWithSchema(ajv, schemaPath, data, context) {
  const schema = await loadJson(schemaPath);
  const validate = ajv.compile(schema);
  const ok = validate(data);
  return { ok, errors: ok ? [] : formatErrors(validate.errors), context };
}

async function validateTasks(ajv) {
  const schemaPath = path.join(REPO_ROOT, 'schemas', 'task.schema.json');
  const roots = [];
  if (await exists(TASKS_DIR)) roots.push(TASKS_DIR);
  // legacy flat fallback handled by scanning both
  if (await exists(MCP_TASK_DIR_LEGACY) && MCP_TASK_DIR_LEGACY !== TASKS_DIR) roots.push(MCP_TASK_DIR_LEGACY);
  const files = [];
  for (const dir of roots) {
    const arr = await fg('**/*.json', { cwd: dir, dot: false });
    for (const f of arr) files.push(path.join(dir, f));
  }
  const results = [];
  for (const f of files) {
    const obj = await loadJson(f);
    results.push(await validateWithSchema(ajv, schemaPath, obj, rel(f)));
  }
  return results;
}

async function validateKnowledge(ajv) {
  const schemaPath = path.join(REPO_ROOT, 'schemas', 'knowledge.schema.json');
  const roots = [];
  if (await exists(KNOWLEDGE_DIR)) roots.push(KNOWLEDGE_DIR);
  if (await exists(MCP_KNOWLEDGE_DIR_LEGACY) && MCP_KNOWLEDGE_DIR_LEGACY !== KNOWLEDGE_DIR) roots.push(MCP_KNOWLEDGE_DIR_LEGACY);
  const files = [];
  for (const dir of roots) {
    const arr = await fg('**/*.md', { cwd: dir, dot: false });
    for (const f of arr) files.push(path.join(dir, f));
  }
  const results = [];
  for (const f of files) {
    const raw = await fs.readFile(f, 'utf8');
    const fm = matter(raw);
    const meta = fm.data || {};
    results.push(await validateWithSchema(ajv, schemaPath, meta, rel(f) + '#frontmatter'));
  }
  return results;
}

async function validatePromptsExports(ajv) {
  const out = [];
  // Catalog
  const catalogFile = path.join(EXPORTS_CATALOG_DIR, 'prompts.catalog.json');
  if (await exists(catalogFile)) {
    const obj = await loadJson(catalogFile);
    out.push(await validateWithSchema(ajv, path.join(REPO_ROOT, 'schemas', 'prompts.catalog.schema.json'), obj, rel(catalogFile)));
  }
  // Builds
  if (await exists(EXPORTS_BUILDS_DIR)) {
    const bfiles = await fg('**/*.json', { cwd: EXPORTS_BUILDS_DIR, dot: false });
    for (const f of bfiles) {
      const full = path.join(EXPORTS_BUILDS_DIR, f);
      const obj = await loadJson(full);
      out.push(await validateWithSchema(ajv, path.join(REPO_ROOT, 'schemas', 'prompts.build.schema.json'), obj, rel(full)));
    }
  }
  // Services embedded
  const servicesFile = path.join(EXPORTS_CATALOG_DIR, 'services.embedded.json');
  if (await exists(servicesFile)) {
    const obj = await loadJson(servicesFile);
    out.push(await validateWithSchema(ajv, path.join(REPO_ROOT, 'schemas', 'services.embedded.schema.json'), obj, rel(servicesFile)));
  }
  // AB report
  const abFile = path.join(EXPORTS_CATALOG_DIR, 'experiments.report.json');
  if (await exists(abFile)) {
    const obj = await loadJson(abFile);
    out.push(await validateWithSchema(ajv, path.join(REPO_ROOT, 'schemas', 'ab.report.schema.json'), obj, rel(abFile)));
  }
  return out;
}

async function validateFeedbackJsonl(ajv) {
  const results = [];
  if (!(await exists(EXPERIMENTS_DIR))) return results;
  const files = await fg('**/*.jsonl', { cwd: EXPERIMENTS_DIR, dot: false });
  const schemaPath = path.join(REPO_ROOT, 'schemas', 'feedback.event.schema.json');
  for (const f of files) {
    const full = path.join(EXPERIMENTS_DIR, f);
    const raw = await fs.readFile(full, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      let obj = null;
      try { obj = JSON.parse(lines[i]); } catch (e) {
        results.push({ ok: false, errors: [`line ${i+1}: invalid JSON: ${e.message}`], context: rel(full) });
        continue;
      }
      results.push(await validateWithSchema(ajv, schemaPath, obj, rel(full) + `:line:${i+1}`));
    }
  }
  return results;
}

function summarise(results, title) {
  const total = results.length;
  const failed = results.filter(r => !r.ok);
  const ok = total - failed.length;
  if (total === 0) {
    console.log(`- ${title}: no files to validate`);
    return { total, ok, failed: failed.length };
  }
  console.log(`- ${title}: ${ok}/${total} ok`);
  for (const r of failed) {
    console.log(`  x ${r.context}`);
    for (const e of r.errors) console.log(`    - ${e}`);
  }
  return { total, ok, failed: failed.length };
}

async function main() {
  const ajv = createAjv();
  const sections = [];
  sections.push(['Tasks', await validateTasks(ajv)]);
  sections.push(['Knowledge', await validateKnowledge(ajv)]);
  sections.push(['Prompts Exports', await validatePromptsExports(ajv)]);
  sections.push(['Feedback JSONL', await validateFeedbackJsonl(ajv)]);

  console.log(`Schema validation (project=${CURRENT_PROJECT})`);
  let totalFailed = 0;
  for (const [name, res] of sections) {
    const s = summarise(res, name);
    totalFailed += s.failed;
  }
  if (totalFailed > 0) {
    console.error(`Validation failed: ${totalFailed} items`);
    process.exit(2);
  } else {
    console.log('Validation passed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
