#!/usr/bin/env node
// scripts/dashboard.mjs — Render the behavioral dashboard to a single-file HTML (AI-008)
// Usage: node scripts/dashboard.mjs [--storage <path>] [--out <file>] [--stdout]
//   --storage <path>  behavioral data dir (default: .behavioral)
//   --out <file>      write HTML to file (default: dashboard.html)
//   --stdout          print HTML to stdout instead of writing a file

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { BehavioralDashboard } from '../dist/behavioral/dashboard.js';

function parseArgs(argv) {
  const opts = { storage: '.behavioral', out: 'dashboard.html', stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--storage') opts.storage = argv[++i] ?? opts.storage;
    else if (a === '--out') opts.out = argv[++i] ?? opts.out;
    else if (a === '--stdout') opts.stdout = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/dashboard.mjs [--storage <path>] [--out <file>] [--stdout]');
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const storage = resolve(process.cwd(), opts.storage);

const dash = new BehavioralDashboard({ storagePath: storage });
const html = dash.toHtml();

if (opts.stdout) {
  process.stdout.write(html);
} else {
  const out = resolve(process.cwd(), opts.out);
  writeFileSync(out, html);
  const data = dash.compute();
  console.log(`Dashboard written to ${out}`);
  console.log(`  intents=${data.totals.intents} failures=${data.totals.failures} resolutions=${data.totals.resolutions} errorRate=${(data.totals.errorRate * 100).toFixed(1)}%`);
}
