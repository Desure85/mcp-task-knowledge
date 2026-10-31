'use client';

/**
 * Applies persisted theme choices after hydration and keeps `system` mode in
 * sync with OS changes / other tabs. The inline script already painted the
 * right attributes; this component only reacts to later changes.
 */

import { useEffect } from 'react';
import {
  applyTheme,
  readStoredTheme,
  saveTheme,
  THEME_STORAGE_KEY,
  MODE_STORAGE_KEY,
} from '@/lib/theme';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function ThemeManager() {
  useEffect(() => {
    const apply = () => {
      const stored = readStoredTheme(window.localStorage);
      applyTheme(document.documentElement, stored.theme, stored.mode, systemDark());
    };
    apply();

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const stored = readStoredTheme(window.localStorage);
      if (stored.mode === 'system') apply();
    };
    media?.addEventListener?.('change', onSystemChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === MODE_STORAGE_KEY) apply();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media?.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // A choice made in the switcher is already saved; make it shareable with
  // tabs that do not receive a storage event in the same tab.
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
