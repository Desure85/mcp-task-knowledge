'use client';

/**
 * Theme switch (UI-10): mode (light/dark/system) × palette
 * (Indigo/Petrol/Copper). Accessible menu: aria-haspopup/menu, roving focus
 * via arrow keys, Escape and outside click close it.
 */

import { useEffect, useRef, useState } from 'react';
import {
  applyTheme,
  formatThemeLabel,
  isModeChoice,
  isThemeName,
  MODE_LABELS,
  MODE_STORAGE_KEY,
  MODES,
  readStoredTheme,
  resolveMode,
  saveTheme,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  THEMES,
  type ModeChoice,
  type ResolvedMode,
  type ThemeName,
} from '@/lib/theme';

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('indigo');
  const [mode, setMode] = useState<ModeChoice>('system');
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>('light');
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readStoredTheme(typeof window === 'undefined' ? undefined : window.localStorage);
    setTheme(stored.theme);
    setMode(stored.mode);
    setResolvedMode(applyTheme(document.documentElement, stored.theme, stored.mode, prefersDark()));

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const current = readStoredTheme(window.localStorage);
      if (current.mode === 'system') {
        setResolvedMode(media?.matches === true ? 'dark' : 'light');
      }
    };
    media?.addEventListener?.('change', onSystemChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY && event.key !== MODE_STORAGE_KEY) return;
      const current = readStoredTheme(window.localStorage);
      setTheme(current.theme);
      setMode(current.mode);
      setResolvedMode(resolveMode(current.mode, prefersDark()));
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media?.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
  }, [open]);

  function choose(nextTheme: ThemeName, nextMode: ModeChoice) {
    saveTheme(window.localStorage, { theme: nextTheme, mode: nextMode });
    const resolved = applyTheme(document.documentElement, nextTheme, nextMode, prefersDark());
    window.dispatchEvent(new CustomEvent('mcp:theme-change', { detail: { theme: nextTheme, mode: nextMode } }));
    setTheme(nextTheme);
    setMode(nextMode);
    setResolvedMode(resolved);
    setOpen(false);
  }

  function onModeKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-theme-item]') ?? []);
    const next = buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={`Theme: ${formatThemeLabel(theme, resolvedMode)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[11px] font-medium text-ink hover:bg-surface-2"
      >
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full border border-line-strong bg-accent"
        />
        <span className="hidden sm:inline">{formatThemeLabel(theme, resolvedMode)}</span>
        <span aria-hidden="true" className="text-muted">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-50 mt-1 w-44 rounded-[var(--radius-card)] border border-line bg-surface p-1 text-[12px] shadow-pop"
        >
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Mode</p>
          {MODES.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option}
              data-theme-item
              onKeyDown={(e) => onModeKey(e, index)}
              onClick={() => choose(theme, option)}
              className={`flex w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-surface-2 ${
                mode === option ? 'bg-accent-soft font-medium text-accent' : 'text-ink'
              }`}
            >
              {MODE_LABELS[option]}
              {mode === option && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Palette</p>
          {THEMES.map((option, index) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option}
              data-theme-item
              onKeyDown={(e) => onModeKey(e, MODES.length + index)}
              onClick={() => choose(option, mode)}
              className={`flex w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-surface-2 ${
                theme === option ? 'bg-accent-soft font-medium text-accent' : 'text-ink'
              }`}
            >
              {THEME_LABELS[option]}
              {theme === option && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Keep the guards referenced for future use (e.g. config-driven palettes).
export const THEME_GUARDS = { isThemeName, isModeChoice };
