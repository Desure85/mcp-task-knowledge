'use client';

/**
 * Theme switch (UI-10, UI-33): mode (light/dark/system) × palette
 * (Indigo/Petrol/Copper), plus stored custom themes. Accessible menu:
 * aria-haspopup/menu, roving arrow keys, Escape and outside click close it.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  applyTheme,
  formatThemeLabel,
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
import {
  applyCustomTheme,
  clearCustomTheme,
  readActiveCustomId,
  readCustomThemes,
  writeCustomThemes,
  writeActiveCustomId,
  type CustomTheme,
} from '@/lib/custom-theme';
import { CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY } from '@/lib/theme-tokens';

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

const ITEM =
  'flex w-full items-center justify-between rounded-[var(--radius-control)] px-2 py-1 text-left hover:bg-surface-2';
const ITEM_ON = 'bg-accent-soft font-medium text-accent';
const ITEM_OFF = 'text-ink';
const SECTION = 'px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted';

function applySelection(themeName: ThemeName, modeChoice: ModeChoice, customId: string | null): ResolvedMode {
  const root = document.documentElement;
  const resolved = resolveMode(modeChoice, prefersDark());
  const entry = customId
    ? readCustomThemes(window.localStorage).themes.find((candidate) => candidate.id === customId)
    : undefined;
  if (entry) {
    const result = applyCustomTheme(root, entry, resolved);
    if (!result.ok) applyTheme(root, themeName, modeChoice, prefersDark());
  } else {
    clearCustomTheme(root);
    applyTheme(root, themeName, modeChoice, prefersDark());
  }
  return resolved;
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('indigo');
  const [mode, setMode] = useState<ModeChoice>('system');
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>('light');
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [activeCustomId, setActiveCustomId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readStoredTheme(window.localStorage);
    const store = readCustomThemes(window.localStorage);
    // Persist re-derived tokens so the pre-paint script (which reads storage directly) paints them next load.
    if (store.themes.length > 0) writeCustomThemes(window.localStorage, store);
    const storedActive = readActiveCustomId(window.localStorage);
    const active = storedActive ? store.themes.find((candidate) => candidate.id === storedActive) : undefined;
    const customId = active ? active.id : null;
    setTheme(stored.theme);
    setMode(stored.mode);
    setCustomThemes(store.themes);
    setActiveCustomId(customId);
    setResolvedMode(applySelection(stored.theme, stored.mode, customId));

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      const current = readStoredTheme(window.localStorage);
      if (current.mode !== 'system') return;
      const currentStore = readCustomThemes(window.localStorage);
      const id = readActiveCustomId(window.localStorage);
      const entry = id && currentStore.themes.some((candidate) => candidate.id === id) ? id : null;
      setResolvedMode(resolveMode(current.mode, prefersDark()));
      if (entry) applyCustomTheme(document.documentElement, currentStore.themes.find((c) => c.id === entry), prefersDark() ? 'dark' : 'light');
    };
    media?.addEventListener?.('change', onSystemChange);

    const onStorage = (event: StorageEvent) => {
      const keys = [null, THEME_STORAGE_KEY, MODE_STORAGE_KEY, CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY];
      if (!keys.includes(event.key)) return;
      const current = readStoredTheme(window.localStorage);
      const currentStore = readCustomThemes(window.localStorage);
      const id = readActiveCustomId(window.localStorage);
      const customId = id && currentStore.themes.some((candidate) => candidate.id === id) ? id : null;
      setTheme(current.theme);
      setMode(current.mode);
      setCustomThemes(currentStore.themes);
      setActiveCustomId(customId);
      setResolvedMode(applySelection(current.theme, current.mode, customId));
    };
    window.addEventListener('storage', onStorage);

    // Same-tab changes do not fire `storage`; the themes page announces its
    // own apply/reset so the trigger label never lies about the active theme.
    const onLocal = () => {
      const current = readStoredTheme(window.localStorage);
      const currentStore = readCustomThemes(window.localStorage);
      const id = readActiveCustomId(window.localStorage);
      const customId = id && currentStore.themes.some((candidate) => candidate.id === id) ? id : null;
      setTheme(current.theme);
      setMode(current.mode);
      setCustomThemes(currentStore.themes);
      setActiveCustomId(customId);
      setResolvedMode(resolveMode(current.mode, prefersDark()));
    };
    window.addEventListener('mcp:theme-change', onLocal);

    return () => {
      media?.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mcp:theme-change', onLocal);
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

  function choose(next: { theme?: ThemeName; mode?: ModeChoice; customId?: string | null }) {
    const nextTheme = next.theme ?? theme;
    const nextMode = next.mode ?? mode;
    const nextCustom = next.customId !== undefined ? next.customId : activeCustomId;
    saveTheme(window.localStorage, { theme: nextTheme, mode: nextMode });
    writeActiveCustomId(window.localStorage, nextCustom);
    const resolved = applySelection(nextTheme, nextMode, nextCustom);
    window.dispatchEvent(new CustomEvent('mcp:theme-change', { detail: { theme: nextTheme, mode: nextMode } }));
    setTheme(nextTheme);
    setMode(nextMode);
    setActiveCustomId(nextCustom);
    setResolvedMode(resolved);
    setOpen(false);
  }

  function onItemKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-theme-item]') ?? []);
    const current = buttons.indexOf(event.currentTarget);
    const next = buttons[(current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  }

  const activeCustom = activeCustomId ? customThemes.find((candidate) => candidate.id === activeCustomId) : undefined;
  const label = activeCustom ? `${activeCustom.name} · ${MODE_LABELS[resolvedMode]}` : formatThemeLabel(theme, resolvedMode);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={`Theme: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-[11px] font-medium text-ink hover:bg-surface-2"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-line-strong bg-accent" />
        <span className="hidden sm:inline">{label}</span>
        <span aria-hidden="true" className="text-muted">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-50 mt-1 w-56 rounded-[var(--radius-card)] border border-line bg-surface p-1 text-[12px] shadow-pop"
        >
          <p className={SECTION}>Mode</p>
          {MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option}
              data-theme-item
              onKeyDown={onItemKey}
              onClick={() => choose({ mode: option })}
              className={`${ITEM} ${mode === option ? ITEM_ON : ITEM_OFF}`}
            >
              {MODE_LABELS[option]}
              {mode === option && <span aria-hidden="true">✓</span>}
            </button>
          ))}

          <p className={SECTION}>Palette</p>
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={!activeCustomId && theme === option}
              data-theme-item
              onKeyDown={onItemKey}
              onClick={() => choose({ theme: option, customId: null })}
              className={`${ITEM} ${!activeCustomId && theme === option ? ITEM_ON : ITEM_OFF}`}
            >
              {THEME_LABELS[option]}
              {!activeCustomId && theme === option && <span aria-hidden="true">✓</span>}
            </button>
          ))}

          <p className={SECTION}>Custom</p>
          {customThemes.length === 0 && <p className="px-2 pb-1 text-[11px] text-muted">No custom themes yet</p>}
          {customThemes.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={activeCustomId === option.id}
              data-theme-item
              onKeyDown={onItemKey}
              onClick={() => choose({ customId: option.id })}
              className={`${ITEM} ${activeCustomId === option.id ? ITEM_ON : ITEM_OFF}`}
            >
              <span className="truncate">{option.name}</span>
              {activeCustomId === option.id && <span aria-hidden="true">✓</span>}
            </button>
          ))}

          <div className="mt-1 border-t border-line pt-1">
            <Link
              href="/themes?action=create"
              role="menuitem"
              className={`${ITEM} ${ITEM_OFF}`}
              onClick={() => setOpen(false)}
            >
              New theme…
            </Link>
            <Link href="/themes" role="menuitem" className={`${ITEM} ${ITEM_OFF}`} onClick={() => setOpen(false)}>
              Manage themes…
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
