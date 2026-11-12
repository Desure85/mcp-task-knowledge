#!/usr/bin/env node
/**
 * AA-09 — read-only reconciliation between BACKLOG.md and the task tracker.
 *
 * BACKLOG.md is normative. The tracker receives derived records; this script
 * only reports mismatches and never writes BACKLOG or task files.
 *
 * Mapping file (docs/backlog-tracker-map.json) is explicit:
 *   {
 *     "T-002": { "taskTitle": "1.2 TCP/Unix сервер (multi-client)" },
 *     "TR-20": { "taskId": "3f9c..." }
 *   }
 * A mapping may use exact taskTitle (preferred, stable for humans) or taskId.
 *
 * Usage:
 *   DATA_DIR=/data node scripts/backlog-sync-check.mjs --project mcp
 *   node scripts/backlog-sync-check.mjs --data ./data --project mcp --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function parseArgs(argv) {
  const out = {
    data: process.env.DATA_DIR ?? '',
    project: process.env.CURRENT_PROJECT ?? 'mcp',
    map: path.join(ROOT, 'docs', 'backlog-tracker-map.json'),
    backlog: path.join(ROOT, 'BACKLOG.md'),
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--data': out.data = next(); break;
      case '--project': out.project = next(); break;
      case '--map': out.map = path.resolve(next()); break;
      case '--backlog': out.backlog = path.resolve(next()); break;
      case '--json': out.json = true; break;
      case '-h':
      case '--help':
        console.log('usage: node scripts/backlog-sync-check.mjs --data <DATA_DIR> --project <name> [--map file] [--backlog file] [--json]');
        process.exit(0);
        break;
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  return out;
}

export function canonicalStatus(raw) {
  const text = String(raw ?? '')
    .replace(/[*`]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u2705\u274C]/gu, ' ')
    .trim()
    .toLowerCase();
  const m = text.match(/(in[ _-]?progress|wip|pending|todo|done|completed|closed|blocked|review|deferred)/);
  if (!m) return 'unknown';
  const v = m[1];
  if (v === 'completed' || v === 'closed') return 'done';
  if (/^in[ _-]?progress$/.test(v) || v === 'wip') return 'in_progress';
  if (v === 'todo') return 'pending';
  return v;
}

export function parseBacklog(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const id = cells[1];
    if (!/^[A-Z]+-\d+$/.test(id)) continue;
    rows.set(id, {
      id,
      title: cells[2],
      priority: cells[3],
      statusRaw: cells[4],
      status: canonicalStatus(cells[4]),
    });
  }
  return rows;
}

async function listJsonFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJsonFiles(full)));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

export async function readTrackerTasks(dataDir, project) {
  const files = await listJsonFiles(path.join(dataDir, 'tasks', project));
  const tasks = [];
  for (const file of files) {
    try {
      const task = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!task || typeof task !== 'object' || typeof task.id !== 'string') continue;
      tasks.push({
        id: task.id,
        title: typeof task.title === 'string' ? task.title : '',
        status: canonicalStatus(task.status),
        file,
      });
    } catch {
      // A corrupt task file is not a backlog ID match; the tracker's own
      // validate command owns corruption reporting.
    }
  }
  return tasks;
}

function normalizeTitle(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function reconcile({ backlog, tasks, mapping }) {
  const mismatches = [];
  let checked = 0;
  for (const [backlogId, entry] of Object.entries(mapping)) {
    checked++;
    const backlogRow = backlog.get(backlogId);
    if (!backlogRow) {
      mismatches.push({ backlogId, kind: 'missing-in-backlog', backlog: null, tracker: null });
      continue;
    }
    let task;
    if (entry.taskId) task = tasks.find((t) => t.id === entry.taskId);
    else if (entry.taskTitle) task = tasks.find((t) => normalizeTitle(t.title) === normalizeTitle(entry.taskTitle));
    if (!task) {
      mismatches.push({ backlogId, kind: 'missing-in-tracker', backlog: backlogRow, tracker: null });
      continue;
    }
    if (backlogRow.status !== task.status) {
      mismatches.push({ backlogId, kind: 'status-mismatch', backlog: backlogRow, tracker: task });
    }
  }
  return { checked, mismatches };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data) {
    console.error('AA-09: DATA_DIR (or --data) is required');
    process.exit(2);
  }
  let mapping;
  try {
    mapping = JSON.parse(await fs.readFile(args.map, 'utf8'));
  } catch (e) {
    console.error(`AA-09: cannot read mapping ${args.map}: ${e.message}`);
    process.exit(2);
  }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    console.error('AA-09: mapping must be an object keyed by BACKLOG id');
    process.exit(2);
  }
  let backlogMarkdown;
  try {
    backlogMarkdown = await fs.readFile(args.backlog, 'utf8');
  } catch (e) {
    console.error(`AA-09: cannot read BACKLOG ${args.backlog}: ${e.message}`);
    process.exit(2);
  }
  const backlog = parseBacklog(backlogMarkdown);
  const tasks = await readTrackerTasks(args.data, args.project);
  const result = reconcile({ backlog, tasks, mapping });

  if (args.json) {
    process.stdout.write(JSON.stringify({ project: args.project, dataDir: args.data, ...result }, null, 2) + '\n');
  } else {
    for (const m of result.mismatches) {
      if (m.kind === 'missing-in-backlog') {
        console.log(`MISMATCH ${m.backlogId}: нет в BACKLOG.md`);
      } else if (m.kind === 'missing-in-tracker') {
        console.log(`MISMATCH ${m.backlogId}: нет задачи в трекере (BACKLOG: ${m.backlog.status})`);
      } else {
        console.log(`MISMATCH ${m.backlogId}: BACKLOG=${m.backlog.status}, tracker=${m.tracker.status} (${m.tracker.title})`);
      }
    }
    console.log(`${result.mismatches.length} расхождений (проверено ID: ${result.checked}, задач прочитано: ${tasks.length})`);
  }
  process.exit(result.mismatches.length > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`AA-09: ${e.stack || e.message}`);
    process.exit(2);
  });
}
