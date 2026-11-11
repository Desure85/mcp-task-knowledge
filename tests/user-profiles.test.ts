import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProfileError, UserProfileStore } from '../src/profiles/store.js';

let tmp = '';
let store: UserProfileStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'user-profiles-'));
  store = new UserProfileStore(tmp);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('UI-33a UserProfileStore', () => {
  it('stores one profile per user and returns null for an unknown user', async () => {
    expect(await store.get('u1')).toBeNull();
    const result = await store.set('u1', { theme: 'petrol', mode: 'dark' }, '2026-11-11T12:00:00.000Z', 'device-a');
    expect(result.applied).toBe(true);
    expect(result.profile).toMatchObject({ userId: 'u1', clientId: 'device-a' });
    expect(await store.get('u1')).toEqual(result.profile);
    expect(await store.get('u2')).toBeNull();
  });

  it('applies last-write-wins and reports older writes as conflicts', async () => {
    await store.set('u1', { theme: 'indigo' }, '2026-11-11T12:00:00.000Z');
    const newer = await store.set('u1', { theme: 'copper' }, '2026-11-11T13:00:00.000Z');
    expect(newer.applied).toBe(true);
    const older = await store.set('u1', { theme: 'petrol' }, '2026-11-11T12:30:00.000Z');
    expect(older).toMatchObject({ applied: false, conflict: true });
    expect(older.profile?.preferences).toEqual({ theme: 'copper' });
  });

  it('treats equal payload/timestamp as an idempotent duplicate and rejects equal-time divergence', async () => {
    await store.set('u1', { list: ['a'] }, '2026-11-11T12:00:00.000Z');
    expect(await store.set('u1', { list: ['a'] }, '2026-11-11T12:00:00.000Z')).toMatchObject({ applied: false, duplicate: true, conflict: false });
    expect(await store.set('u1', { list: ['b'] }, '2026-11-11T12:00:00.000Z')).toMatchObject({ applied: false, duplicate: false, conflict: true });
  });

  it('serializes concurrent writes without losing the last record', async () => {
    await Promise.all([
      store.set('u1', { n: 1 }, '2026-11-11T12:00:00.000Z'),
      store.set('u1', { n: 2 }, '2026-11-11T12:00:01.000Z'),
      store.set('u1', { n: 3 }, '2026-11-11T12:00:02.000Z'),
    ]);
    expect((await store.get('u1'))?.preferences).toEqual({ n: 3 });
  });

  it('rejects invalid timestamps and oversized payloads', async () => {
    await expect(store.set('u1', {}, 'not-a-date')).rejects.toMatchObject({ code: 'INVALID_TIME' });
    await expect(store.set('u1', { big: 'x'.repeat(40_000) }, '2026-11-11T12:00:00.000Z')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(store.set('u1', {}, 'bad')).rejects.toBeInstanceOf(ProfileError);
  });
});
