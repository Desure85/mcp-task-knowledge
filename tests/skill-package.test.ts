import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import {
  SKILL_FILE_NAME,
  SkillPackageError,
  SkillPackageStore,
  normalizeSkillPackageName,
  normalizeSkillPackagePath,
  readSkillPackage,
  resolveSkillPackagePath,
  writeSkillPackage,
} from '../src/skills/skill-package.js';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(DATA_DIR, `.tmp-z01-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sha(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

describe('Z-01: package path safety', () => {
  it('normalizes relative paths and rejects escapes/absolute/portable hazards', () => {
    expect(normalizeSkillPackagePath('references/guide.md')).toBe('references/guide.md');
    expect(normalizeSkillPackagePath('references\\guide.md')).toBe('references/guide.md');
    for (const bad of ['../escape.md', 'a/../../b', '/etc/passwd', 'C:\\temp\\x', 'a\\..\\b', 'a\x00b']) {
      expect(() => normalizeSkillPackagePath(bad)).toThrow(SkillPackageError);
    }
    expect(() => normalizeSkillPackagePath('CON.md')).toThrow(/portable/);
    expect(() => normalizeSkillPackagePath('trailing.')).toThrow(/portable/);
  });

  it('resolves paths inside the root only', () => {
    const root = tempDir('resolve');
    expect(resolveSkillPackagePath(root, 'a/b.md')).toBe(path.join(root, 'a', 'b.md'));
    expect(() => resolveSkillPackagePath(root, '../outside')).toThrow(/escapes/);
  });

  it('validates package names for the store', () => {
    expect(normalizeSkillPackageName('code-review')).toBe('code-review');
    for (const bad of ['../x', 'A/B', '', '.', '..', 'a b']) {
      expect(() => normalizeSkillPackageName(bad)).toThrow(SkillPackageError);
    }
  });
});

describe('Z-01: reading a package', () => {
  it('reads SKILL.md and attachments with deterministic order and hashes', () => {
    const root = tempDir('read');
    const skill = '---\nname: review-kit\ndescription: Review helpers\n---\n\n# Review\n';
    fs.writeFileSync(path.join(root, SKILL_FILE_NAME), skill, 'utf8');
    fs.mkdirSync(path.join(root, 'references'));
    fs.writeFileSync(path.join(root, 'references', 'guide.md'), 'guide body', 'utf8');
    fs.writeFileSync(path.join(root, 'examples.md'), 'examples', 'utf8');

    const pkg = readSkillPackage(root);
    expect(pkg.name).toBe('review-kit');
    expect(pkg.description).toBe('Review helpers');
    expect(pkg.files.map((file) => file.path)).toEqual(['SKILL.md', 'examples.md', 'references/guide.md']);
    const byPath = Object.fromEntries(pkg.files.map((file) => [file.path, file]));
    expect(byPath['references/guide.md'].sha256).toBe(sha('guide body'));
    expect(byPath[SKILL_FILE_NAME].sha256).toBe(sha(skill));
    expect(pkg.totalBytes).toBe(Buffer.byteLength(skill) + 'guide body'.length + 'examples'.length);
  });

  it('requires SKILL.md', () => {
    const root = tempDir('missing');
    fs.writeFileSync(path.join(root, 'other.md'), 'x');
    expect(() => readSkillPackage(root)).toThrow(/must contain SKILL\.md/);
  });

  it('rejects symlinks instead of following them', () => {
    const root = tempDir('symlink');
    fs.writeFileSync(path.join(root, SKILL_FILE_NAME), '# Skill');
    const outside = path.join(tempDir('outside'), 'secret.md');
    fs.writeFileSync(outside, 'secret');
    try {
      fs.symlinkSync(outside, path.join(root, 'link.md'), 'file');
    } catch {
      return; // Windows without symlink privilege: covered by path validation/hash tests.
    }
    expect(() => readSkillPackage(root)).toThrow(/symlink/i);
  });
});

describe('Z-01: limits and writing', () => {
  it('rejects a file over the per-file limit and a package over the total limit', () => {
    const root = tempDir('limits');
    fs.writeFileSync(path.join(root, SKILL_FILE_NAME), '# Skill');
    fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(64));
    expect(() => readSkillPackage(root, { maxFileBytes: 32 })).toThrow(/limit 32/);
    expect(() => readSkillPackage(root, { maxTotalBytes: 10 })).toThrow(/exceeds/);
    expect(() => readSkillPackage(root, { maxFiles: 1 })).toThrow(/more than 1/);
  });

  it('writes a validated package and reads it back', () => {
    const root = path.join(tempDir('write'), 'pkg');
    const pkg = writeSkillPackage(root, [
      { path: SKILL_FILE_NAME, content: '---\nname: written\ndescription: d\n---\nbody' },
      { path: 'references/a.md', content: 'A' },
    ]);
    expect(pkg.name).toBe('written');
    expect(pkg.files.map((file) => file.path)).toEqual([SKILL_FILE_NAME, 'references/a.md']);
    expect(fs.readFileSync(path.join(root, 'references', 'a.md'), 'utf8')).toBe('A');
  });

  it('rejects traversal, absolute paths, duplicates, missing SKILL.md and limits before writing', () => {
    const base = tempDir('reject');
    expect(() => writeSkillPackage(path.join(base, 'a'), [{ path: '../escape.md', content: 'x' }])).toThrow(/escapes/);
    expect(() => writeSkillPackage(path.join(base, 'b'), [{ path: '/abs.md', content: 'x' }])).toThrow(/absolute/);
    expect(() => writeSkillPackage(path.join(base, 'c'), [
      { path: SKILL_FILE_NAME, content: 'x' },
      { path: SKILL_FILE_NAME, content: 'y' },
    ])).toThrow(/duplicate/);
    expect(() => writeSkillPackage(path.join(base, 'd'), [{ path: 'only.md', content: 'x' }])).toThrow(/must contain/);
    expect(() => writeSkillPackage(path.join(base, 'e'), [
      { path: SKILL_FILE_NAME, content: 'x' },
      { path: 'big', content: 'z'.repeat(32) },
    ], { maxFileBytes: 16 })).toThrow(/limit 16/);
    expect(fs.existsSync(path.join(base, 'a'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'e'))).toBe(false);
  });

  it('refuses to write into a non-empty directory', () => {
    const root = tempDir('nonempty');
    fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
    expect(() => writeSkillPackage(root, [{ path: SKILL_FILE_NAME, content: 'x' }])).toThrow(/not empty/);
    expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe('keep');
  });
});

describe('Z-01: file-profile package store', () => {
  it('installs, lists, reads, overwrites and removes packages', () => {
    const source = tempDir('install-src');
    fs.writeFileSync(path.join(source, SKILL_FILE_NAME), '---\nname: stored\ndescription: d\n---\nbody');
    const root = path.join(tempDir('store'), 'skills');
    const store = new SkillPackageStore(root);
    expect(store.list()).toEqual([]);
    expect(() => store.read('stored')).toThrow(/not found/);

    const installed = store.install(source, 'stored');
    expect(installed.name).toBe('stored');
    expect(store.list().map((pkg) => pkg.name)).toEqual(['stored']);
    expect(store.read('stored').files.map((file) => file.path)).toEqual([SKILL_FILE_NAME]);
    expect(() => store.install(source, 'stored')).toThrow(/already installed/);

    const replacement = tempDir('install-replace');
    fs.writeFileSync(path.join(replacement, SKILL_FILE_NAME), '---\nname: stored\ndescription: d2\n---\nnew');
    const overwritten = store.install(replacement, 'stored', { overwrite: true });
    expect(overwritten.description).toBe('d2');
    expect(fs.readFileSync(path.join(root, 'stored', SKILL_FILE_NAME), 'utf8')).toContain('new');
    expect(store.remove('stored')).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.remove('stored')).toBe(false);
  });

  it('rejects escaping store names', () => {
    const store = new SkillPackageStore(path.join(tempDir('store-safe'), 'skills'));
    expect(() => store.read('../outside')).toThrow(/invalid skill package name/);
    expect(() => store.remove('a/b')).toThrow(/invalid skill package name/);
  });
});
