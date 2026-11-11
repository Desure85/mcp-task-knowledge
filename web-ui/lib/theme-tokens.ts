/**
 * web-ui/lib/theme-tokens.ts — Names shared by CSS, the pre-paint script and
 * the custom-theme derivation. No imports here on purpose: `lib/theme.ts`
 * (which builds the inline script) and `lib/custom-theme.ts` both import this
 * module, so a cycle would otherwise make the script depend on the derivation.
 */

export const CUSTOM_THEME_NAME = 'custom';
export const CUSTOM_STORE_KEY = 'mcp.customThemes';
export const CUSTOM_ACTIVE_KEY = 'mcp.customActive';
export const CUSTOM_STORE_VERSION = 1;

export const MAX_CUSTOM_THEMES = 20;
export const MAX_STORE_BYTES = 64 * 1024;
export const MAX_THEME_NAME = 40;
export const MAX_STORED_COLOR = 48;

/** Colour tokens a custom theme overrides; `--shadow-pop` stays per mode. */
export const COLOR_TOKENS = [
  'canvas',
  'surface',
  'surface-2',
  'line',
  'line-strong',
  'ink',
  'muted',
  'accent',
  'accent-hover',
  'accent-soft',
  'on-accent',
  'st-todo',
  'st-doing',
  'st-review',
  'st-blocked',
  'st-done',
  'st-archive',
  'st-slate',
  'st-blue',
  'st-indigo',
  'st-violet',
  'st-pink',
  'st-red',
  'st-orange',
  'st-amber',
  'st-green',
  'st-teal',
  'st-cyan',
  'st-gray',
  'ty-bug',
  'ty-feature',
  'ty-task',
  'pr-high',
  'pr-med',
  'pr-low',
  'danger',
  'success',
  'warning',
  'info',
  'focus',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(COLOR_TOKENS);

export const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
