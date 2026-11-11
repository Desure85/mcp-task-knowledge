'use client';

/**
 * UI-33a — reconciles the localStorage theme cache with the server profile once
 * the shell is ready and after every local theme change.
 */
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import { pushLocalThemeChange, syncThemeProfile } from '@/lib/theme-sync';

export function ThemeSync() {
  const applying = useRef(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!alive) return;
      try {
        await syncThemeProfile(api.profile, window.localStorage);
      } catch {
        // offline: the pending slot is handled by syncThemeProfile
      }
    };
    void run();

    const onTheme = async (event: Event) => {
      if (applying.current) return;
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source === 'server') return;
      try {
        applying.current = true;
        await pushLocalThemeChange(api.profile, window.localStorage);
      } catch {
        // offline queue is written by pushLocalThemeChange
      } finally {
        applying.current = false;
      }
    };
    const onOnline = () => { void run(); };
    window.addEventListener('mcp:theme-change', onTheme);
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      window.removeEventListener('mcp:theme-change', onTheme);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
