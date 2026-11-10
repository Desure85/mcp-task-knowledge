/**
 * Z-01: skill package model.
 *
 * A skill package is a directory with a required `SKILL.md` and optional attachments. This module
 * validates the package before it is read or written:
 *
 *   - every path is relative, POSIX-normalized and cannot escape the package root (`..`, absolute
 *     paths, Windows drive letters/ADS, reserved device names);
 *   - symlinks are rejected instead of followed;
 *   - per-file, total-size and file-count limits are enforced;
 *   - every file gets a sha256 so a package can be compared/transferred without trusting mtimes.
 *
 * `SkillPackageStore` keeps packages under one root (`<root>/<name>/`) and installs atomically via a
 * temporary directory. Only the file profile needs this; no storage contract changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';

export const SKILL_FILE_NAME = 'SKILL.md';

export const SKILL_PACKAGE_LIMITS = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFiles: 200,
  maxPathLength: 512,
} as const;

export type SkillPackageErrorCode =
  | 'SKILL_MISSING'
  | 'SKILL_INVALID'
  | 'PATH_INVALID'
  | 'PATH_ESCAPE'
  | 'PATH_DUPLICATE'
  | 'SYMLINK_REJECTED'
  | 'FILE_TOO_LARGE'
  | 'PACKAGE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'PACKAGE_EXISTS'
  | 'PACKAGE_NOT_FOUND'
  | 'NAME_INVALID';

export class SkillPackageError extends Error {
  constructor(
    public readonly code: SkillPackageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SkillPackageError';
  }
}

export interface SkillPackageFile {
  /** POSIX-style relative path inside the package. */
  path: string;
  size: number;
  /** Lowercase hex sha256 of the file bytes. */
  sha256: string;
}

export interface SkillPackage {
  name: string;
  description: string;
  /** Absolute package directory. */
  root: string;
  files: SkillPackageFile[];
  totalBytes: number;
}

export interface SkillPackageOptions {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
  maxPathLength?: number;
}

export interface SkillPackageInputFile {
  path: string;
  content: string | Uint8Array;
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Normalize and validate one package-relative path. Throws `SkillPackageError` with a stable code.
 */
export function normalizeSkillPackagePath(input: string, options: SkillPackageOptions = {}): string {
  const maxPathLength = options.maxPathLength ?? SKILL_PACKAGE_LIMITS.maxPathLength;
  if (typeof input !== 'string' || input.length === 0) {
    throw new SkillPackageError('PATH_INVALID', 'empty package path');
  }
  if (input.includes('\0') || /[\u0000-\u001f]/.test(input)) {
    throw new SkillPackageError('PATH_INVALID', `control character in package path: ${JSON.stringify(input)}`);
  }
  const slashed = input.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed) || slashed.includes(':')) {
    throw new SkillPackageError('PATH_ESCAPE', `absolute or drive path is not allowed: ${input}`);
  }
  if (slashed.length > maxPathLength) {
    throw new SkillPackageError('PATH_INVALID', `package path is too long (${slashed.length} > ${maxPathLength})`);
  }
  const segments = slashed.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SkillPackageError('PATH_ESCAPE', `path escapes or is not normalized: ${input}`);
    }
    if (segment.length > 255) {
      throw new SkillPackageError('PATH_INVALID', `path segment is too long: ${input}`);
    }
    if (/[. ]$/.test(segment) || RESERVED_WINDOWS_NAMES.test(segment)) {
      throw new SkillPackageError('PATH_INVALID', `path segment is not portable: ${input}`);
    }
  }
  return segments.join('/');
}

/** Resolve a validated package-relative path under `root` and prove containment. */
export function resolveSkillPackagePath(root: string, relative: string): string {
  const normalized = normalizeSkillPackagePath(relative);
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, normalized);
  if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + path.sep)) {
    throw new SkillPackageError('PATH_ESCAPE', `path escapes package root: ${relative}`);
  }
  return candidate;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function listFiles(root: string, options: Required<SkillPackageOptions>, prefix = ''): Array<{ path: string; absolute: string; size: number }> {
  const result: Array<{ path: string; absolute: string; size: number }> = [];
  const directory = prefix ? path.join(root, ...prefix.split('/')) : root;
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const relative = normalizeSkillPackagePath(prefix ? `${prefix}/${entry.name}` : entry.name, options);
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new SkillPackageError('SYMLINK_REJECTED', `symlink is not allowed in a skill package: ${relative}`);
    }
    if (stat.isDirectory()) {
      result.push(...listFiles(root, options, relative));
      continue;
    }
    if (!stat.isFile()) {
      throw new SkillPackageError('PATH_INVALID', `unsupported filesystem entry in package: ${relative}`);
    }
    if (stat.size > options.maxFileBytes) {
      throw new SkillPackageError(
        'FILE_TOO_LARGE',
        `file ${relative} is ${stat.size} bytes (limit ${options.maxFileBytes})`,
      );
    }
    result.push({ path: relative, absolute, size: stat.size });
    if (result.length > options.maxFiles) {
      throw new SkillPackageError('TOO_MANY_FILES', `package has more than ${options.maxFiles} files`);
    }
  }
  return result;
}

function parseSkillHeader(content: string): { name?: string; description?: string } {
  try {
    const parsed = matter(content);
    const name = typeof parsed.data.name === 'string' ? parsed.data.name : undefined;
    const description = typeof parsed.data.description === 'string' ? parsed.data.description : undefined;
    return { name, description };
  } catch {
    return {};
  }
}

/** Read and validate a skill package from disk. */
export function readSkillPackage(root: string, options: SkillPackageOptions = {}): SkillPackage {
  const resolvedRoot = path.resolve(root);
  const stat = fs.existsSync(resolvedRoot) ? fs.statSync(resolvedRoot) : undefined;
  if (!stat || !stat.isDirectory()) {
    throw new SkillPackageError('PACKAGE_NOT_FOUND', `skill package directory not found: ${root}`);
  }
  const limits: Required<SkillPackageOptions> = {
    maxFileBytes: options.maxFileBytes ?? SKILL_PACKAGE_LIMITS.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? SKILL_PACKAGE_LIMITS.maxTotalBytes,
    maxFiles: options.maxFiles ?? SKILL_PACKAGE_LIMITS.maxFiles,
    maxPathLength: options.maxPathLength ?? SKILL_PACKAGE_LIMITS.maxPathLength,
  };
  const entries = listFiles(resolvedRoot, limits);
  const skillEntry = entries.find((entry) => entry.path === SKILL_FILE_NAME);
  if (!skillEntry) {
    throw new SkillPackageError('SKILL_MISSING', `skill package must contain ${SKILL_FILE_NAME}`);
  }
  const files: SkillPackageFile[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = fs.readFileSync(entry.absolute);
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new SkillPackageError('PACKAGE_TOO_LARGE', `package exceeds ${limits.maxTotalBytes} bytes`);
    }
    files.push({ path: entry.path, size: bytes.length, sha256: sha256(bytes) });
  }
  const header = parseSkillHeader(fs.readFileSync(skillEntry.absolute, 'utf8'));
  return {
    name: header.name ?? path.basename(resolvedRoot),
    description: header.description ?? '',
    root: resolvedRoot,
    files,
    totalBytes,
  };
}

/** Validate and write a package atomically to `root` (the directory itself must not exist yet). */
export function writeSkillPackage(
  root: string,
  input: SkillPackageInputFile[],
  options: SkillPackageOptions = {},
): SkillPackage {
  const limits: Required<SkillPackageOptions> = {
    maxFileBytes: options.maxFileBytes ?? SKILL_PACKAGE_LIMITS.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? SKILL_PACKAGE_LIMITS.maxTotalBytes,
    maxFiles: options.maxFiles ?? SKILL_PACKAGE_LIMITS.maxFiles,
    maxPathLength: options.maxPathLength ?? SKILL_PACKAGE_LIMITS.maxPathLength,
  };
  if (input.length === 0) throw new SkillPackageError('SKILL_MISSING', `skill package must contain ${SKILL_FILE_NAME}`);
  if (input.length > limits.maxFiles) {
    throw new SkillPackageError('TOO_MANY_FILES', `package has more than ${limits.maxFiles} files`);
  }
  const seen = new Set<string>();
  const prepared: Array<{ path: string; bytes: Buffer }> = [];
  let totalBytes = 0;
  for (const file of input) {
    const normalized = normalizeSkillPackagePath(file.path, limits);
    if (seen.has(normalized)) {
      throw new SkillPackageError('PATH_DUPLICATE', `duplicate package path: ${normalized}`);
    }
    seen.add(normalized);
    const bytes = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : Buffer.from(file.content);
    if (bytes.length > limits.maxFileBytes) {
      throw new SkillPackageError('FILE_TOO_LARGE', `file ${normalized} is ${bytes.length} bytes (limit ${limits.maxFileBytes})`);
    }
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new SkillPackageError('PACKAGE_TOO_LARGE', `package exceeds ${limits.maxTotalBytes} bytes`);
    }
    prepared.push({ path: normalized, bytes });
  }
  if (!seen.has(SKILL_FILE_NAME)) {
    throw new SkillPackageError('SKILL_MISSING', `skill package must contain ${SKILL_FILE_NAME}`);
  }
  const resolvedRoot = path.resolve(root);
  if (fs.existsSync(resolvedRoot) && fs.readdirSync(resolvedRoot).length > 0) {
    throw new SkillPackageError('PACKAGE_EXISTS', `skill package directory is not empty: ${root}`);
  }
  fs.mkdirSync(resolvedRoot, { recursive: true });
  for (const file of prepared) {
    const absolute = resolveSkillPackagePath(resolvedRoot, file.path);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, file.bytes);
    fs.renameSync(temporary, absolute);
  }
  return readSkillPackage(resolvedRoot, limits);
}

/** Stable name for a package directory: lowercase slug, no separators. */
export function normalizeSkillPackageName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) || name === '.' || name === '..') {
    throw new SkillPackageError('NAME_INVALID', `invalid skill package name: ${name}`);
  }
  return name;
}

/**
 * File-profile package store. Packages live under `<root>/<name>/`; installs go through a temp
 * directory and only then rename, so a failed copy never looks like a complete package.
 */
export class SkillPackageStore {
  constructor(public readonly root: string) {}

  list(): Array<Pick<SkillPackage, 'name' | 'files' | 'totalBytes'>> {
    if (!fs.existsSync(this.root)) return [];
    return fs
      .readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => {
        const pkg = readSkillPackage(path.join(this.root, entry.name));
        return { name: pkg.name, files: pkg.files, totalBytes: pkg.totalBytes };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  read(name: string): SkillPackage {
    const directory = path.join(this.root, normalizeSkillPackageName(name));
    if (!fs.existsSync(directory)) {
      throw new SkillPackageError('PACKAGE_NOT_FOUND', `skill package not found: ${name}`);
    }
    return readSkillPackage(directory);
  }

  install(source: string, name: string, options: { overwrite?: boolean } = {}): SkillPackage {
    const normalizedName = normalizeSkillPackageName(name);
    const pkg = readSkillPackage(source);
    fs.mkdirSync(this.root, { recursive: true });
    const destination = path.join(this.root, normalizedName);
    if (fs.existsSync(destination)) {
      if (!options.overwrite) {
        throw new SkillPackageError('PACKAGE_EXISTS', `skill package already installed: ${normalizedName}`);
      }
      fs.rmSync(destination, { recursive: true, force: true });
    }
    const staging = path.join(this.root, `.staging-${normalizedName}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);
    try {
      const files: SkillPackageInputFile[] = pkg.files.map((file) => ({
        path: file.path,
        content: fs.readFileSync(resolveSkillPackagePath(pkg.root, file.path)),
      }));
      writeSkillPackage(staging, files);
      fs.renameSync(staging, destination);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return readSkillPackage(destination);
  }

  remove(name: string): boolean {
    const destination = path.join(this.root, normalizeSkillPackageName(name));
    if (!fs.existsSync(destination)) return false;
    fs.rmSync(destination, { recursive: true, force: true });
    return true;
  }
}
