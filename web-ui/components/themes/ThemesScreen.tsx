'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ColorField,
  Dialog,
  Input,
} from '@/components/ui';
import { isColor } from '@/lib/contrast';
import {
  DEFAULT_BASE,
  analyzeMode,
  applyCustomTheme,
  buildTheme,
  clearCustomTheme,
  importThemeJson,
  previewTokens,
  readActiveCustomId,
  readCustomThemes,
  validateThemeName,
  writeActiveCustomId,
  writeCustomThemes,
  type CustomTheme,
  type CustomThemeStore,
  type ThemeBase,
  type ThemeMode,
} from '@/lib/custom-theme';
import { MAX_CUSTOM_THEMES } from '@/lib/theme-tokens';
import {
  DEFAULT_THEME,
  THEMES,
  THEME_LABELS,
  applyTheme,
  readStoredTheme,
  resolveMode,
  saveTheme,
  type ThemeName,
} from '@/lib/theme';
import { ContrastPanel } from './ContrastPanel';
import { ImportExportPanel } from './ImportExportPanel';
import { ThemePreview } from './ThemePreview';

interface Draft {
  name: string;
  base: Record<ThemeMode, ThemeBase>;
}

const EMPTY_STORE: CustomThemeStore = { version: 1, themes: [] };

function cloneBase(base: ThemeBase): ThemeBase {
  return { ...base };
}

function draftFrom(theme: CustomTheme): Draft {
  return { name: theme.name, base: { light: cloneBase(theme.base.light), dark: cloneBase(theme.base.dark) } };
}

function freshDraft(count: number): Draft {
  return {
    name: `Custom theme ${count + 1}`,
    base: { light: cloneBase(DEFAULT_BASE.light), dark: cloneBase(DEFAULT_BASE.dark) },
  };
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function colorError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isColor(value) ? undefined : 'Нужен hex, rgb() или hsl()';
}

function ModeFields({
  mode,
  base,
  onChange,
}: {
  mode: ThemeMode;
  base: ThemeBase;
  onChange: (next: ThemeBase) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {mode === 'light' ? 'Light mode' : 'Dark mode'}
      </p>
      <ColorField
        label="Accent"
        value={base.accent}
        onChange={(value) => onChange({ ...base, accent: value })}
        error={colorError(base.accent)}
      />
      <ColorField
        label="Background"
        value={base.background}
        onChange={(value) => onChange({ ...base, background: value })}
        error={colorError(base.background)}
      />
      <ColorField
        label="Text"
        value={base.text}
        onChange={(value) => onChange({ ...base, text: value })}
        error={colorError(base.text)}
      />
      <ColorField
        label="Warning (optional)"
        value={base.warning ?? ''}
        onChange={(value) => onChange({ ...base, warning: value || undefined })}
        error={colorError(base.warning)}
      />
      <ColorField
        label="Danger (optional)"
        value={base.danger ?? ''}
        onChange={(value) => onChange({ ...base, danger: value || undefined })}
        error={colorError(base.danger)}
      />
    </div>
  );
}

export function ThemesScreen() {
  const [store, setStore] = useState<CustomThemeStore>(EMPTY_STORE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => freshDraft(0));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [palette, setPalette] = useState<ThemeName>(DEFAULT_THEME);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomTheme | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    const loaded = readCustomThemes(window.localStorage);
    setStore(loaded);
    setActiveId(readActiveCustomId(window.localStorage));
    setPalette(readStoredTheme(window.localStorage).theme);
    const first = loaded.themes[0];
    if (first) {
      setSelectedId(first.id);
      setDraft(draftFrom(first));
    }
    if (new URLSearchParams(window.location.search).get('action') === 'create') {
      setSelectedId(null);
      setDraft(freshDraft(loaded.themes.length));
    }
  }, []);

  const selected = selectedId ? store.themes.find((theme) => theme.id === selectedId) ?? null : null;
  const analyses = useMemo(
    () => ({ light: analyzeMode(draft.base.light, 'light'), dark: analyzeMode(draft.base.dark, 'dark') }),
    [draft],
  );
  const blocking = analyses.light.blocking || analyses.dark.blocking;
  const nameCheck = validateThemeName(draft.name);

  function notify(kind: 'error' | 'ok', text: string) {
    setMessage({ kind, text });
  }

  function persist(next: CustomThemeStore): boolean {
    if (!writeCustomThemes(window.localStorage, next)) {
      notify('error', 'Не удалось сохранить: хранилище браузера недоступно.');
      return false;
    }
    return true;
  }

  function resolvedTone() {
    const stored = readStoredTheme(window.localStorage);
    return { stored, resolved: resolveMode(stored.mode, prefersDark()) };
  }

  function announce(theme: ThemeName) {
    const stored = readStoredTheme(window.localStorage);
    window.dispatchEvent(new CustomEvent('mcp:theme-change', { detail: { theme, mode: stored.mode } }));
  }

  function applyNow(theme: CustomTheme) {
    const { stored, resolved } = resolvedTone();
    const result = applyCustomTheme(document.documentElement, theme, resolved);
    writeActiveCustomId(window.localStorage, result.ok ? theme.id : null);
    setActiveId(result.ok ? theme.id : null);
    if (!result.ok) notify('error', result.error);
    else announce(stored.theme);
  }

  function startNew() {
    setSelectedId(null);
    setDraft(freshDraft(store.themes.length));
    notify('ok', 'Новая тема: настройте цвета — сохранение включится, когда все критичные пары пройдут AA.');
  }

  function save() {
    if (!nameCheck.ok) {
      notify('error', 'Исправьте имя темы.');
      return;
    }
    const built = buildTheme({ name: draft.name, base: draft.base }, { id: selectedId ?? undefined });
    if (!built.ok) {
      notify('error', built.error);
      return;
    }
    const theme: CustomTheme = { ...built.theme, createdAt: selected?.createdAt ?? built.theme.createdAt };
    const themes = selectedId
      ? store.themes.map((entry) => (entry.id === selectedId ? theme : entry))
      : [...store.themes, theme];
    if (themes.length > MAX_CUSTOM_THEMES) {
      notify('error', `Не больше ${MAX_CUSTOM_THEMES} тем.`);
      return;
    }
    const next: CustomThemeStore = { version: 1, themes };
    if (!persist(next)) return;
    setStore(next);
    setSelectedId(theme.id);
    setDraft(draftFrom(theme));
    applyNow(theme);
    notify('ok', `Тема «${theme.name}» сохранена и применена.`);
  }

  function duplicate() {
    const built = buildTheme({ name: `${draft.name} copy`, base: draft.base });
    if (!built.ok) {
      notify('error', built.error);
      return;
    }
    if (store.themes.length >= MAX_CUSTOM_THEMES) {
      notify('error', `Не больше ${MAX_CUSTOM_THEMES} тем.`);
      return;
    }
    const next: CustomThemeStore = { version: 1, themes: [...store.themes, built.theme] };
    if (!persist(next)) return;
    setStore(next);
    setSelectedId(built.theme.id);
    setDraft(draftFrom(built.theme));
    notify('ok', `Создана копия «${built.theme.name}».`);
  }

  function remove(target: CustomTheme) {
    const next: CustomThemeStore = { version: 1, themes: store.themes.filter((theme) => theme.id !== target.id) };
    if (!persist(next)) return;
    setStore(next);
    setDeleteTarget(null);
    if (activeId === target.id) {
      writeActiveCustomId(window.localStorage, null);
      clearCustomTheme(document.documentElement);
      const stored = readStoredTheme(window.localStorage);
      applyTheme(document.documentElement, stored.theme, stored.mode, prefersDark());
      setActiveId(null);
    }
    if (selectedId === target.id) {
      const fallback = next.themes[0];
      setSelectedId(fallback ? fallback.id : null);
      setDraft(fallback ? draftFrom(fallback) : freshDraft(next.themes.length));
    }
    notify('ok', `Тема «${target.name}» удалена.`);
  }

  function importText(text: string) {
    const imported = importThemeJson(text);
    if (!imported.ok) {
      notify('error', imported.error);
      return;
    }
    if (store.themes.length >= MAX_CUSTOM_THEMES) {
      notify('error', `Не больше ${MAX_CUSTOM_THEMES} тем.`);
      return;
    }
    const next: CustomThemeStore = { version: 1, themes: [...store.themes, imported.theme] };
    if (!persist(next)) return;
    setStore(next);
    setSelectedId(imported.theme.id);
    setDraft(draftFrom(imported.theme));
    applyNow(imported.theme);
    notify('ok', `Импортирована тема «${imported.theme.name}».`);
  }

  function usePalette(name: ThemeName) {
    const stored = readStoredTheme(window.localStorage);
    writeActiveCustomId(window.localStorage, null);
    clearCustomTheme(document.documentElement);
    saveTheme(window.localStorage, { theme: name, mode: stored.mode });
    applyTheme(document.documentElement, name, stored.mode, prefersDark());
    setPalette(name);
    setActiveId(null);
    announce(name);
    notify('ok', `Включена палитра ${THEME_LABELS[name]}.`);
  }

  function resetToDefault() {
    setResetOpen(false);
    usePalette(DEFAULT_THEME);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-3">
        <Card>
          <CardHeader className="text-[12px] font-semibold">Built-in palettes</CardHeader>
          <CardBody className="space-y-1">
            {THEMES.map((name) => (
              <div key={name} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink">{THEME_LABELS[name]}</span>
                <Button
                  size="sm"
                  variant={!activeId && palette === name ? 'primary' : 'secondary'}
                  onClick={() => usePalette(name)}
                >
                  Use
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between gap-2 text-[12px] font-semibold">
            <span>Custom themes</span>
            <Badge tone="neutral">{store.themes.length}</Badge>
          </CardHeader>
          <CardBody className="space-y-1">
            {store.themes.length === 0 && (
              <p className="text-[11px] text-muted">Пока нет своих тем. Создайте первую.</p>
            )}
            {store.themes.map((theme) => (
              <div
                key={theme.id}
                className={`flex items-center justify-between gap-1 rounded-[var(--radius-control)] px-1 py-0.5 ${
                  theme.id === selectedId ? 'bg-accent-soft' : ''
                }`}
              >
                <span className="truncate text-[12px] text-ink">{theme.name}</span>
                <Button
                  size="sm"
                  variant={activeId === theme.id ? 'primary' : 'ghost'}
                  onClick={() => {
                    setSelectedId(theme.id);
                    setDraft(draftFrom(theme));
                    applyNow(theme);
                  }}
                >
                  {activeId === theme.id ? 'Active' : 'Use'}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={startNew}>
                New theme
              </Button>
              <Button size="sm" variant="ghost" onClick={duplicate}>
                Duplicate
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-3">
        {message && (
          <div
            role="alert"
            className={`flex items-start justify-between gap-2 rounded-[var(--radius-card)] border p-2 text-[11px] ${
              message.kind === 'error' ? 'border-danger/40 text-danger' : 'border-line text-success'
            }`}
          >
            <span>{message.text}</span>
            <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <Card>
          <CardHeader className="flex items-center justify-between gap-2 text-[12px] font-semibold">
            <span>Editor</span>
            <Badge tone={selected ? 'done' : 'neutral'}>{selected ? 'saved theme' : 'unsaved draft'}</Badge>
          </CardHeader>
          <CardBody className="space-y-3">
            <Input
              label="Theme name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              hint="До 40 символов: буквы, цифры, пробел, точка, дефис, подчёркивание."
              error={nameCheck.ok ? undefined : nameCheck.error}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <ModeFields
                mode="light"
                base={draft.base.light}
                onChange={(next) => setDraft({ ...draft, base: { ...draft.base, light: next } })}
              />
              <ModeFields
                mode="dark"
                base={draft.base.dark}
                onChange={(next) => setDraft({ ...draft, base: { ...draft.base, dark: next } })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={save} disabled={blocking}>
                Save theme
              </Button>
              <Button onClick={() => selected && applyNow(selected)} disabled={!selected}>
                Apply saved
              </Button>
              <Button variant="ghost" onClick={startNew}>
                New
              </Button>
              <Button variant="ghost" onClick={() => setResetOpen(true)}>
                Reset to default palette
              </Button>
              <Button variant="danger" onClick={() => selected && setDeleteTarget(selected)} disabled={!selected}>
                Delete
              </Button>
            </div>
            {blocking && (
              <p role="alert" className="text-[11px] text-danger">
                Сохранение заблокировано: критичные пары не проходят AA. Исправьте цвета в таблице ниже.
              </p>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview · Light</p>
            <ThemePreview
              tokens={
                analyses.light.derivation.ok
                  ? analyses.light.derivation.tokens
                  : previewTokens(draft.base.light, 'light')
              }
              mode="light"
            />
            <ContrastPanel analysis={analyses.light} />
          </div>
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Preview · Dark</p>
            <ThemePreview
              tokens={
                analyses.dark.derivation.ok ? analyses.dark.derivation.tokens : previewTokens(draft.base.dark, 'dark')
              }
              mode="dark"
            />
            <ContrastPanel analysis={analyses.dark} />
          </div>
        </div>

        <ImportExportPanel selected={selected} onImport={importText} />
      </div>

      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete theme?"
        description={deleteTarget ? `«${deleteTarget.name}» будет удалена. Это нельзя отменить.` : ''}
        destructive
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteTarget && remove(deleteTarget)}>
              Delete
            </Button>
          </>
        }
      />

      <Dialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset to the default palette?"
        description="Свои темы останутся в списке; на интерфейс вернётся Indigo."
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={resetToDefault}>
              Reset
            </Button>
          </>
        }
      />
    </div>
  );
}
