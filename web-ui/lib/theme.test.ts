import { describe, it, expect, vi } from 'vitest';
import {
  applyTheme,
  MODE_STORAGE_KEY,
  readStoredTheme,
  resolveMode,
  saveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme model (UI-10)', () => {
  it('resolves explicit modes and follows the OS only for system', () => {
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('garbage', true)).toBe('dark');
  });

  it('reads valid stored choices and falls back for invalid/missing values', () => {
    const storage = {
      getItem: (key: string) => (key === THEME_STORAGE_KEY ? 'petrol' : key === MODE_STORAGE_KEY ? 'dark' : null),
    };
    expect(readStoredTheme(storage)).toEqual({ theme: 'petrol', mode: 'dark' });

    expect(readStoredTheme({ getItem: () => 'nope' })).toEqual({ theme: 'indigo', mode: 'system' });
    expect(readStoredTheme(undefined)).toEqual({ theme: 'indigo', mode: 'system' });
  });

  it('survives blocked storage (private mode) with defaults', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme(blocked)).toEqual({ theme: 'indigo', mode: 'system' });
    expect(() =>
      saveTheme(
        {
          setItem: () => {
            throw new Error('blocked');
          },
        },
        { theme: 'copper', mode: 'dark' },
      ),
    ).not.toThrow();
  });

  it('persists both axes', () => {
    const setItem = vi.fn();
    saveTheme({ setItem }, { theme: 'copper', mode: 'light' });
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'copper');
    expect(setItem).toHaveBeenCalledWith(MODE_STORAGE_KEY, 'light');
  });

  it('applies attributes and color-scheme to the root', () => {
    const attrs: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      style: {} as { colorScheme?: string },
    };
    const resolved = applyTheme(root, 'petrol', 'system', true);
    expect(resolved).toBe('dark');
    expect(attrs).toEqual({ 'data-theme': 'petrol', 'data-mode': 'dark' });
    expect(root.style.colorScheme).toBe('dark');
  });

  it('inline script reads both keys, defaults to indigo/system and guards errors', () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain(MODE_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("'indigo'");
    expect(THEME_INIT_SCRIPT).toContain("'system'");
    expect(THEME_INIT_SCRIPT).toContain('prefers-color-scheme: dark');
    expect(THEME_INIT_SCRIPT).toContain('try{');
    expect(THEME_INIT_SCRIPT).toContain('catch(e)');
  });
});
