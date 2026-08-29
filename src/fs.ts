import fs from 'node:fs/promises';
import path from 'node:path';

/** Create a directory (and parents) if missing — idempotent. */
export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Read a JSON file and parse it. Throws on missing file or invalid JSON. */
export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Atomically write a JSON file (tmp + rename) so a crash/ENOSPC mid-write
 * never corrupts the existing file (Q-013). Cleans the tmp file on failure.
 */
export async function writeJson(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // Clean up the tmp file so a failed write leaves no debris
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/** Whether a file/dir exists. Never throws. */
export async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Read a UTF-8 text file. */
export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

/** Write a UTF-8 text file (creates parent dirs). */
export async function writeText(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}
