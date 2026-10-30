/**
 * tests/data-path-hardening.spec.ts — AUD-18a/b/f regression tests.
 * Each assertion fails on the pre-fix code (traversal wrote outside the
 * profile dir; stores/writeText wrote in place; deleteProfile used `require`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileManager } from '../src/memory/user-profile.js';
import { writeText, writeFileAtomicSync, PathValidationError } from '../src/fs.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dph-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('ProfileManager userId path guard (AUD-18a)', () => {
  const evil = ['../escape', 'a/b', 'a\\b', '../../etc/passwd', 'x\u0000y'];

  it.each(evil)('rejects %j for update/get/delete without touching the filesystem', (id) => {
    const dir = join(root, 'profiles');
    const mgr = new ProfileManager({ storagePath: dir });
    expect(() => mgr.updateProfile(id, { staticFacts: { name: 'x' } } as never)).toThrow(PathValidationError);
    expect(() => mgr.getProfile(id)).toThrow(PathValidationError);
    expect(() => mgr.deleteProfile(id)).toThrow(PathValidationError);
    expect(existsSync(join(root, 'escape.json'))).toBe(false);
  });

  it('deleteProfile really deletes a legitimate profile', () => {
    const mgr = new ProfileManager({ storagePath: join(root, 'profiles') });
    mgr.updateProfile('alice', {} as never);
    expect(existsSync(join(root, 'profiles', 'alice.json'))).toBe(true);
    expect(mgr.deleteProfile('alice')).toBe(true);
    expect(existsSync(join(root, 'profiles', 'alice.json'))).toBe(false);
  });
});

describe('atomic writes (AUD-18b/f)', () => {
  it('writeText replaces content and leaves no tmp debris', async () => {
    const f = join(root, 'd', 'doc.md');
    await writeText(f, 'one');
    await writeText(f, 'two');
    expect(readFileSync(f, 'utf-8')).toBe('two');
    expect(readdirSync(join(root, 'd'))).toEqual(['doc.md']);
  });

  it('a failed rename keeps the previous file intact and removes the tmp', () => {
    const f = join(root, 'keep.json');
    writeFileSync(f, 'old');
    // Make the target a directory so rename(file → dir) fails after the tmp was written.
    const bad = join(root, 'dir.json');
    mkdirSync(bad);
    expect(() => writeFileAtomicSync(bad, 'new')).toThrow();
    expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(readFileSync(f, 'utf-8')).toBe('old');
  });
});
