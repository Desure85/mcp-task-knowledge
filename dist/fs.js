import fs from 'node:fs/promises';
import path from 'node:path';
export async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
export async function readJson(filePath) {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
}
export async function writeJson(filePath, data) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
export async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
export async function readText(filePath) {
    return fs.readFile(filePath, 'utf-8');
}
export async function writeText(filePath, content) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
}
