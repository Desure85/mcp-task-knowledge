import { describe, expect, it } from 'vitest';
import {
  mergeThemeSnapshots,
  readLocalThemeSnapshot,
  readPendingSnapshot,
  writeLocalThemeSnapshot,
  writePendingSnapshot,
  type ThemeSnapshot,
} from './theme-sync';

function storage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, value); },
  } as Storage;
}

function snapshot(theme: ThemeSnapshot['theme'], updatedAt: string): ThemeSnapshot {
  return {
    version: 1,
    theme,
    mode: 'dark',
    customThemes: { version: 1, themes: [] },
    activeCustomId: null,
    updatedAt,
  };
}

describe('UI-33a theme sync snapshots', () => {
  it('reads defaults with an epoch timestamp when no local choice exists', () => {
    const local = readLocalThemeSnapshot(storage());
    expect(local.theme).toBe('indigo');
    expect(local.mode).toBe('system');
    expect(local.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('writes and reads a full snapshot including custom themes', () => {
    const s = storage();
    writeLocalThemeSnapshot(s, snapshot('copper', '2026-11-11T12:00:00.000Z'));
    const read = readLocalThemeSnapshot(s);
    expect(read).toMatchObject({ theme: 'copper', mode: 'dark', updatedAt: '2026-11-11T12:00:00.000Z' });
  });

  it('uses the newer updatedAt and is idempotent on equal timestamps', () => {
    const local = snapshot('indigo', '2026-11-11T12:00:00.000Z');
    const server = snapshot('petrol', '2026-11-11T13:00:00.000Z');
    expect(mergeThemeSnapshots(local, server).theme).toBe('petrol');
    expect(mergeThemeSnapshots(server, local).theme).toBe('petrol');
    expect(mergeThemeSnapshots(local, null).theme).toBe('indigo');
  });

  it('persists exactly one pending offline snapshot', () => {
    const s = storage();
    expect(readPendingSnapshot(s)).toBeNull();
    writePendingSnapshot(s, snapshot('petrol', '2026-11-11T12:00:00.000Z'));
    expect(readPendingSnapshot(s)?.theme).toBe('petrol');
    writePendingSnapshot(s, null);
    expect(readPendingSnapshot(s)).toBeNull();
  });
});
