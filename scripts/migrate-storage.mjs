#!/usr/bin/env node
/**
 * Y-08a — CLI-обёртка над migrate-storage.
 *
 * Usage:
 *   node scripts/migrate-storage.mjs --data .data --direction file-to-sqlite [--db path] [--dry-run] [--verify] [--json]
 *
 * The engine is `src/storage/migrate.ts` (built to `dist/`); this wrapper only parses arguments so the
 * runbook works without the MCP server. Requires `npm run build` first.
 */

import path from 'node:path';

function parse(argv) {
  const options = { direction: 'file-to-sqlite', dryRun: false, verify: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--data') options.data = argv[++index];
    else if (arg === '--db') options.db = argv[++index];
    else if (arg === '--direction') options.direction = argv[++index];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--json') options.json = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!options.data) {
    console.error('migrate-storage: --data is required');
    process.exit(2);
  }
  if (options.direction !== 'file-to-sqlite' && options.direction !== 'sqlite-to-file') {
    console.error('migrate-storage: --direction must be file-to-sqlite or sqlite-to-file');
    process.exit(2);
  }
  return options;
}

const options = parse(process.argv.slice(2));
const modulePath = new URL('../dist/storage/migrate.js', import.meta.url).href;
const { migrateStorage } = await import(modulePath);

const report = await migrateStorage({
  dataDir: options.data,
  databasePath: options.db ?? path.join(options.data, '.index', 'storage.sqlite'),
  direction: options.direction,
  dryRun: options.dryRun,
  verifyOnly: options.verify,
});
if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const lines = [
    `migrate-storage (${report.direction}${report.dryRun ? ', dry-run' : report.verifyOnly ? ', verify' : ''})`,
    `tasks: ${JSON.stringify(report.counts.tasks)}`,
    `docs: ${JSON.stringify(report.counts.docs)}`,
    `projects: ${JSON.stringify(report.counts.projects)}`,
    `versions: ${JSON.stringify(report.counts.versions)}`,
    `blobs: ${JSON.stringify(report.counts.blobs)}`,
    `checksums equal: ${report.checksums.equal}`,
    ...(report.backupPath ? [`backup: ${report.backupPath}`] : []),
    ...report.discrepancies.map((entry) => `discrepancy: ${entry}`),
    report.switchHint,
    `duration: ${report.durationMs}ms`,
  ];
  console.log(lines.join('\n'));
}
process.exit(report.checksums.equal || report.dryRun || report.verifyOnly ? 0 : 1);
