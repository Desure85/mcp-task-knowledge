/**
 * web-ui/lib/theme-pairs.ts — The WCAG AA pair matrix in one place.
 *
 * The CI gate (`theme.contrast.test.ts`), the custom-theme derivation and the
 * editor's live table read the same list, so a palette cannot pass one check
 * and fail another. `CRITICAL_PAIRS` block saving a custom theme; the rest are
 * advisory.
 */

export type ContrastPair = readonly [foreground: string, background: string, threshold: number];

const STATUS = ['st-todo', 'st-doing', 'st-review', 'st-blocked', 'st-done', 'st-archive'];
const TYPES = ['ty-bug', 'ty-feature', 'ty-task'];

/** UI-40: hue tokens shared by status and type palettes. */
export const HUE_COLOR_TOKENS = [
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
] as const;

/** UI-40: links to semantic theme colours instead of a fixed hue. */
export const THEME_COLOR_TOKENS = ['accent', 'success', 'warning', 'danger', 'info'] as const;

export const PALETTE_COLOR_TOKENS = [...HUE_COLOR_TOKENS, ...THEME_COLOR_TOKENS] as const;

const ALL_STATUS = [...STATUS, ...PALETTE_COLOR_TOKENS];
const ALL_TYPES = [...TYPES, ...PALETTE_COLOR_TOKENS];
const THEME_REFS = ['accent', 'success', 'warning', 'danger', 'info'];

const PRIORITIES = ['pr-high', 'pr-med', 'pr-low'];

export const TEXT_PAIRS: readonly ContrastPair[] = [
  ['ink', 'canvas', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'canvas', 4.5],
  ['muted', 'surface', 4.5],
  ['muted', 'surface-2', 4.5],
  ['ink', 'surface-2', 4.5],
  ['accent', 'canvas', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'accent-soft', 4.5],
  ['on-accent', 'accent', 4.5],
  ...ALL_STATUS.map((key) => [key, 'surface', 4.5] as const),
  ...ALL_STATUS.map((key) => [key, 'surface-2', 3] as const),
  ...ALL_TYPES.map((key) => [key, 'surface', 4.5] as const),
  ...THEME_REFS.map((key) => [key, 'surface-2', 3] as const),
  ...PRIORITIES.map((key) => [key, 'surface', 4.5] as const),
  ...PRIORITIES.map((key) => [key, 'surface-2', 3] as const),
  ['line-strong', 'canvas', 3],
  ['st-done', 'canvas', 3],
  ['focus-ring', 'canvas', 3],
  ['st-archive', 'canvas', 3],
  ['danger', 'canvas', 3],
  ['success', 'canvas', 3],
  ['info', 'canvas', 3],
];

/** Pairs whose failure blocks saving a custom theme. */
export const CRITICAL_PAIRS: readonly ContrastPair[] = [
  ['ink', 'canvas', 4.5],
  ['ink', 'surface', 4.5],
  ['accent', 'canvas', 4.5],
  ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
];

/** CSS exposes `--focus`; the pair matrix calls it `focus-ring`. */
export const TOKEN_ALIAS: Record<string, string> = { 'focus-ring': 'focus' };

export function tokenForPair(name: string): string {
  return TOKEN_ALIAS[name] ?? name;
}

export function pairKey(pair: ContrastPair): string {
  return `${pair[0]}/${pair[1]}`;
}

export const CRITICAL_PAIR_KEYS: ReadonlySet<string> = new Set(CRITICAL_PAIRS.map(pairKey));
