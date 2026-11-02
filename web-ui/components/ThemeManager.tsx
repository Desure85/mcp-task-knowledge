'use client';

/**
 * Applies persisted theme choices after hydration and keeps `system` mode in
 * sync with OS changes / other tabs. The inline script already painted the
 * right attributes; this component only reacts to later changes and re-applies
 * a custom theme when the palette axis points at one (UI-33).
 */

import { useEffect } from 'react';
import {
  applyTheme,
  readStoredTheme,
  resolveMode,
  saveTheme,
  THEME_STORAGE_KEY,
  MODE_STORAGE_KEY,
} from '@/lib/theme';
import { applyCustomTheme, clearCustomTheme, readActiveCustomId, readCustomThemes } from '@/lib/custom-theme';
import { CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY } from '@/lib/theme-tokens';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function ThemeManager() {
  useEffect(() => {
    const apply = () => {
      const stored = readStoredTheme(window.localStorage);
      const root = document.documentElement;
      const store = readCustomThemes(window.localStorage);
      const activeId = readActiveCustomId(window.localStorage);
      const entry = activeId ? store.themes.find((candidate) => candidate.id === activeId) : undefined;
      if (entry) {
        const resolved = resolveMode(stored.mode, systemDark());
        const result = applyCustomTheme(root, entry, resolved);
        if (!result.ok) applyTheme(root, stored.theme, stored.mode, systemDark());
        return;
      }
      clearCustomTheme(root);
      applyTheme(root, stored.theme, stored.mode, systemDark());
    };
    apply();

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const stored = readStoredTheme(window.localStorage);
      if (stored.mode === 'system') apply();
    };
    media?.addEventListener?.('change', onSystemChange);

    const onStorage = (event: StorageEvent) => {
      const keys = [null, THEME_STORAGE_KEY, MODE_STORAGE_KEY, CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY];
      if (keys.includes(event.key)) apply();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media?.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<{ theme: 'indigo' | 'petrol' | 'copper'; mode: 'light' | 'dark' | 'system' }>).detail;
      if (detail) saveTheme(window.localStorage, detail);
    };
    window.addEventListener('mcp:theme-change', onLocal);
    return () => window.removeEventListener('mcp:theme-change', onLocal);
  }, []);

  return null;
}
