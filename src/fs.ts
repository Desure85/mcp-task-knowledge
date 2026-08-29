import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  // Atomic write: tmp file + rename — a crash/ENOSPC mid-write never corrupts
  // the existing file (Q-013). rename() is atomic on POSIX and Windows.
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

export async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

export async function writeText(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}
