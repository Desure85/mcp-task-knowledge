/**
 * web-ui/lib/theme.ts — theme model shared by the inline script, the Topbar
 * switcher and tests (UI-10).
 *
 * Two independent axes:
 *   theme (palette): indigo | petrol | copper
 *   mode:            light | dark | system (system resolves via matchMedia)
 *
 * Persisted in localStorage under `mcp.theme` / `mcp.mode`. The inline script
 * in app/layout.tsx applies the attributes before first paint; this module is
 * the pure logic behind it.
 *
 * UI-33 adds a third source: a custom theme (`mcp.customActive` +
 * `mcp.customThemes`) overrides the colour tokens from `data-theme="custom"`.
 * The script reads that store too, so a custom theme paints without a flash.
 */

import { COLOR_TOKENS, CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY, CUSTOM_THEME_NAME } from './theme-tokens';

export const THEMES = ['indigo', 'petrol', 'copper'] as const;
export const MODES = ['light', 'dark', 'system'] as const;

export type ThemeName = (typeof THEMES)[number];
export type ModeChoice = (typeof MODES)[number];
export type ResolvedMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mcp.theme';
export const MODE_STORAGE_KEY = 'mcp.mode';
export const DEFAULT_THEME: ThemeName = 'indigo';
export const DEFAULT_MODE: ModeChoice = 'system';

export const THEME_LABELS: Record<ThemeName, string> = {
  indigo: 'Indigo',
  petrol: 'Petrol',
  copper: 'Copper',
};

export const MODE_LABELS: Record<ModeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * Visible switcher label. It reflects the mode actually applied to
 * `<html data-mode>` — including `system`, which resolves to light/dark.
 */
export function formatThemeLabel(theme: ThemeName, resolvedMode: ResolvedMode): string {
  return `${THEME_LABELS[theme]} · ${MODE_LABELS[resolvedMode]}`;
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function isModeChoice(value: unknown): value is ModeChoice {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** Resolve the stored mode against the OS preference. */
export function resolveMode(choice: unknown, systemDark: boolean): ResolvedMode {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemDark ? 'dark' : 'light';
}

export interface StoredTheme {
  theme: ThemeName;
  mode: ModeChoice;
}

type ReadableStorage = Pick<Storage, 'getItem'> | null | undefined;

/** Read persisted choices; invalid/missing values fall back to defaults. */
export function readStoredTheme(storage: ReadableStorage): StoredTheme {
  try {
    const theme = storage?.getItem(THEME_STORAGE_KEY);
    const mode = storage?.getItem(MODE_STORAGE_KEY);
    return {
      theme: isThemeName(theme) ? theme : DEFAULT_THEME,
      mode: isModeChoice(mode) ? mode : DEFAULT_MODE,
    };
  } catch {
    // Private mode / blocked storage: the page still works with defaults.
    return { theme: DEFAULT_THEME, mode: DEFAULT_MODE };
  }
}

type WritableStorage = Pick<Storage, 'setItem'> | null | undefined;

/** Persist choices; silently no-op when storage is unavailable. */
export function saveTheme(storage: WritableStorage, choice: StoredTheme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, choice.theme);
    storage?.setItem(MODE_STORAGE_KEY, choice.mode);
  } catch {
    // blocked storage — the in-memory/DOM choice still applies for this tab
  }
}

export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  style?: { colorScheme?: string };
}

/** Apply the resolved mode + palette to the document root. */
export function applyTheme(
  root: ThemeRoot,
  theme: ThemeName,
  mode: ModeChoice,
  systemDark: boolean,
): ResolvedMode {
  const resolved = resolveMode(mode, systemDark);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', resolved);
  if (root.style) root.style.colorScheme = resolved;
  return resolved;
}

/**
 * Runs in <head> before paint. Kept dependency-free and try/catch-guarded;
 * `suppressHydrationWarning` on <html> covers the attributes added here.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var themes=${JSON.stringify(THEMES)},modes=${JSON.stringify(MODES)},colorTokens=${JSON.stringify(COLOR_TOKENS)};
var t=localStorage.getItem('${THEME_STORAGE_KEY}'),m=localStorage.getItem('${MODE_STORAGE_KEY}');
t=themes.indexOf(t)>=0?t:'${DEFAULT_THEME}';
m=modes.indexOf(m)>=0?m:'${DEFAULT_MODE}';
var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var rmode=m==='light'||m==='dark'?m:(dark?'dark':'light');
var root=document.documentElement;
var tokens=null;
try{
var active=localStorage.getItem('${CUSTOM_ACTIVE_KEY}');
var raw=localStorage.getItem('${CUSTOM_STORE_KEY}');
if(active&&raw){var store=JSON.parse(raw);if(store&&store.version===1&&store.themes&&store.themes.length){for(var i=0;i<store.themes.length;i++){var theme=store.themes[i];if(theme&&theme.id===active&&theme.tokens&&theme.tokens[rmode]){tokens=theme.tokens[rmode];break;}}}}
}catch(err){tokens=null;}
var ok=!!tokens;
if(ok){for(var k=0;k<colorTokens.length;k++){var value=tokens[colorTokens[k]];if(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value)){ok=false;break;}}}
if(ok){for(var j=0;j<colorTokens.length;j++){root.style.setProperty('--'+colorTokens[j],tokens[colorTokens[j]]);}}
root.setAttribute('data-theme',ok?'${CUSTOM_THEME_NAME}':t);
root.setAttribute('data-mode',rmode);
root.style.colorScheme=rmode;
}catch(e){var el=document.documentElement;el.setAttribute('data-theme','${DEFAULT_THEME}');el.setAttribute('data-mode','light');el.style.colorScheme='light';}})();`;
