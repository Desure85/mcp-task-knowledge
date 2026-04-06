/**
 * Global test setup — sets env vars required by config.ts
 * before any module that imports config.ts is loaded.
 *
 * config.ts throws if DATA_DIR is not set at module evaluation time.
 * This setup runs before any test file imports are resolved.
 */

import path from 'node:path';
import fs from 'node:fs';

// Create a temp data dir for tests
const tmpDir = path.join(process.cwd(), '.tmp-vitest');
fs.mkdirSync(tmpDir, { recursive: true });

process.env.DATA_DIR = tmpDir;
process.env.OBSIDIAN_VAULT_ROOT = path.join(tmpDir, 'vault');
