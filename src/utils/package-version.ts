/**
 * TR-24 — one package-version lookup shared by schema-version and register/setup.
 *
 * Resolution order: npm_package_version (when present) → package.json two
 * levels above this module → '0.0.0'. Works for both src/utils (tsx) and
 * dist/utils (built package).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function getPackageVersion(): Promise<string> {
  const fromEnv = process.env.npm_package_version;
  if (fromEnv && typeof fromEnv === 'string') return fromEnv;
  try {
    const raw = await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
