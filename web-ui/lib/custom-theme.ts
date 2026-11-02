/**
 * web-ui/lib/custom-theme.ts — User themes (UI-33).
 *
 * A theme is four (optionally five) base colours per mode. Every other token
 * is derived here so that the WCAG AA pair matrix holds **by construction**:
 * each derived colour is searched along its own lightness axis until the pair
 * passes. When a pair cannot be satisfied (or the accent equals the
 * background) the derivation refuses with a readable error instead of storing
 * an inaccessible theme.
 *
 * Stored themes keep the derived tokens as well, because the pre-paint script
 * in `lib/theme.ts` must apply a theme before first paint without shipping the
 * derivation. Tokens are always re-derived on save/import, so a hand-edited
 * localStorage value cannot smuggle a failing palette in.
 */

import {
  contrastRatio,
  hslToRgb,
  mix,
  parseColor,
  relativeLuminance,
  rgbToHsl,
  toHex,
  isColor,
} from './contrast';
import { DEFAULT_THEME } from './theme';
import {
  CRITICAL_PAIRS,
  TEXT_PAIRS,
  pairKey,
  tokenForPair,
  type ContrastPair,
} from './theme-pairs';
import {
  COLOR_TOKENS,
  CUSTOM_ACTIVE_KEY,
  CUSTOM_STORE_KEY,
  CUSTOM_STORE_VERSION,
  CUSTOM_THEME_NAME,
  HEX6_RE,
  MAX_CUSTOM_THEMES,
  MAX_STORE_BYTES,
  MAX_STORED_COLOR,
  MAX_THEME_NAME,
  type ColorToken,
} from './theme-tokens';

export type ThemeMode = 'light' | 'dark';

export interface ThemeBase {
  accent: string;
  background: string;
  text: string;
  warning?: string;
  danger?: string;
}

export type TokenMap = Record<ColorToken, string>;

export interface CustomTheme {
  id: string;
  name: string;
  base: Record<ThemeMode, ThemeBase>;
  tokens: Record<ThemeMode, TokenMap>;
  createdAt: string;
  updatedAt: string;
}

export interface CustomThemeStore {
  version: typeof CUSTOM_STORE_VERSION;
  themes: CustomTheme[];
}

const WHITE = '#ffffff';
const INK_ON_DARK = '#0b0d10';

const STATUS_SEED: Record<ThemeMode, { review: string; success: string; warning: string; danger: string; archive: string }> = {
  light: {
    review: '#6d28d9',
    success: '#0e7a5f',
    warning: '#b45309',
    danger: '#b42318',
    archive: '#6b7280',
  },
  dark: {
    review: '#b49bf5',
    success: '#57c79b',
    warning: '#e0a45a',
    danger: '#f08a80',
    archive: '#8b93a0',
  },
};

export const DEFAULT_BASE: Record<ThemeMode, ThemeBase> = {
  light: { accent: '#4f46e5', background: '#fbfbfc', text: '#14171c', warning: '#b45309', danger: '#b42318' },
  dark: { accent: '#8b87ff', background: '#101216', text: '#e9ebf0', warning: '#e0a45a', danger: '#f08a80' },
};

const BASE_KEYS = ['accent', 'background', 'text', 'warning', 'danger'] as const;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

export interface DerivationFailure {
  ok: false;
  error: string;
  pair?: ContrastPair;
  ratio?: number;
}

export interface DerivationSuccess {
  ok: true;
  tokens: TokenMap;
  warnings: string[];
}

export type Derivation = DerivationSuccess | DerivationFailure;

export interface PairCheck {
  pair: ContrastPair;
  key: string;
  critical: boolean;
  ratio: number;
  threshold: number;
  pass: boolean;
}

export interface ModeAnalysis {
  mode: ThemeMode;
  derivation: Derivation;
  checks: PairCheck[];
  blocking: boolean;
  advisoryFailures: number;
}

function ratio(a: string, b: string): number {
  return contrastRatio(a, b);
}

function colorDistance(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2) / (255 * Math.sqrt(3));
}

/** Nearest lightness of `fg` (same hue/saturation) that reaches `min` on `bg`. */
export function findContrast(fg: string, bg: string, min: number): string | null {
  const start = toHex(fg);
  if (ratio(start, bg) >= min - 1e-9) return start;
  const { h, s, l } = rgbToHsl(parseColor(start));
  const bgLum = relativeLuminance(bg);
  const towardsWhite = 1.05 / (bgLum + 0.05);
  const towardsBlack = (bgLum + 0.05) / 0.05;
  const directions = towardsWhite >= towardsBlack ? [1, -1] : [-1, 1];
  for (const direction of directions) {
    for (let step = 1; step <= 100; step += 1) {
      const next = l + (direction * step) / 100;
      if (next < 0 || next > 1) break;
      const candidate = toHex(hslToRgb({ h, s, l: next }));
      if (ratio(candidate, bg) >= min - 1e-9) return candidate;
    }
  }
  return null;
}

/** Moves a background away from `fg` (used for soft fills such as accent-soft). */
function findBackground(ink: string, bg: string, min: number): string | null {
  if (ratio(ink, bg) >= min - 1e-9) return toHex(bg);
  const { h, s, l } = rgbToHsl(parseColor(bg));
  const direction = relativeLuminance(ink) > 0.5 ? -1 : 1;
  for (let step = 1; step <= 100; step += 1) {
    const next = l + (direction * step) / 100;
    if (next < 0 || next > 1) break;
    const candidate = toHex(hslToRgb({ h, s, l: next }));
    if (ratio(ink, candidate) >= min - 1e-9) return candidate;
  }
  return null;
}

function shiftLightness(color: string, delta: number): string {
  const { h, s, l } = rgbToHsl(parseColor(color));
  return toHex(hslToRgb({ h, s, l: Math.min(1, Math.max(0, l + delta)) }));
}

/** Moves a background out of the mid-luminance dead zone (max contrast ~4.5). */
function nudgeLightness(color: string, step: number): string {
  const { h, s, l } = rgbToHsl(parseColor(color));
  const direction = relativeLuminance(color) < 0.18 ? -1 : 1;
  return toHex(hslToRgb({ h, s, l: Math.min(1, Math.max(0, l + (direction * step * 12) / 1000)) }));
}

function bestOnAccent(accent: string): string {
  return ratio(WHITE, accent) >= ratio(INK_ON_DARK, accent) ? WHITE : INK_ON_DARK;
}

interface Requirement {
  bg: string;
  min: number;
}

function satisfiesAll(color: string, requirements: readonly Requirement[]): boolean {
  return requirements.every((requirement) => ratio(color, requirement.bg) >= requirement.min - 1e-9);
}

/** One colour that passes every pair it takes part in (not one pair at a time). */
export function findForBackgrounds(fg: string, requirements: readonly Requirement[]): string | null {
  const start = toHex(fg);
  if (satisfiesAll(start, requirements)) return start;
  const { h, s, l } = rgbToHsl(parseColor(start));
  for (const direction of [1, -1]) {
    for (let step = 1; step <= 100; step += 1) {
      const next = l + (direction * step) / 100;
      if (next < 0 || next > 1) break;
      const candidate = toHex(hslToRgb({ h, s, l: next }));
      if (satisfiesAll(candidate, requirements)) return candidate;
    }
  }
  return null;
}

/** Backgrounds and thresholds a token must satisfy, taken from the pair matrix. */
export function requirementsFor(tokensUsed: readonly string[], palette: Record<string, string>): Requirement[] {
  const requirements: Requirement[] = [];
  for (const [fg, bg, min] of TEXT_PAIRS) {
    if (!tokensUsed.includes(tokenForPair(fg))) continue;
    const background = palette[tokenForPair(bg)];
    if (background) requirements.push({ bg: background, min });
  }
  return requirements;
}

function verify(tokens: TokenMap): { failures: PairCheck[]; checks: PairCheck[] } {
  const checks: PairCheck[] = TEXT_PAIRS.map((pair) => {
    const [fg, bg, threshold] = pair;
    const foreground = tokens[tokenForPair(fg) as ColorToken];
    const background = tokens[tokenForPair(bg) as ColorToken];
    const value = ratio(foreground, background);
    return {
      pair,
      key: pairKey(pair),
      critical: CRITICAL_PAIRS.some((critical) => pairKey(critical) === pairKey(pair)),
      ratio: value,
      threshold,
      pass: value + 1e-9 >= threshold,
    };
  });
  return { checks, failures: checks.filter((check) => !check.pass) };
}

/** Derive the full token map for one mode; refuses when AA cannot be met. */
export function deriveMode(base: ThemeBase, mode: ThemeMode): Derivation {
  let canvas: string;
  let inkSeed: string;
  let accentSeed: string;
  try {
    canvas = toHex(base.background);
    inkSeed = toHex(base.text);
    accentSeed = toHex(base.accent);
  } catch {
    return { ok: false, error: 'Некорректный цвет: ожидается hex, rgb() или hsl().' };
  }

  if (colorDistance(accentSeed, canvas) < 0.06) {
    return {
      ok: false,
      error: 'Акцент и фон почти одинаковы — выберите другой акцент.',
      pair: ['accent', 'canvas', 4.5],
      ratio: ratio(accentSeed, canvas),
    };
  }

  const pick = (
    seed: string,
    tokensUsed: readonly string[],
    pair: ContrastPair,
    label: string,
  ): string | DerivationFailure => {
    const requirements = requirementsFor(tokensUsed, palette);
    const found = findForBackgrounds(seed, requirements);
    if (found) return found;
    let worst = { value: Number.POSITIVE_INFINITY, min: pair[2] };
    for (const requirement of requirements) {
      const value = ratio(seed, requirement.bg);
      if (value < worst.value) worst = { value, min: requirement.min };
    }
    return {
      ok: false,
      error: `${label}: не удалось подобрать контраст (${worst.value.toFixed(2)}:1, нужно ${worst.min}:1).`,
      pair,
      ratio: worst.value,
    };
  };

  let surface = mix(canvas, WHITE, 0.06);
  let surface2 = mix(surface, mode === 'light' ? '#000000' : WHITE, 0.06);
  let palette: Record<string, string> = { canvas, surface, 'surface-2': surface2 };

  let ink: string | null = null;
  let canvasWarning: string | null = null;
  for (let step = 0; step <= 14 && !ink; step += 1) {
    if (step > 0) {
      const nudged = nudgeLightness(canvas, step);
      canvas = nudged;
      surface = mix(canvas, WHITE, 0.06);
      surface2 = mix(surface, mode === 'light' ? '#000000' : WHITE, 0.06);
      palette = { canvas, surface, 'surface-2': surface2 };
    }
    const candidate = findForBackgrounds(inkSeed, requirementsFor(['ink'], palette));
    if (candidate) {
      ink = candidate;
      if (step > 0) canvasWarning = `Фон скорректирован для контраста до ${canvas}.`;
    }
  }
  if (!ink) {
    return {
      ok: false,
      error: `Текст не контрастирует с фоном ${canvas} — выберите фон светлее или темнее.`,
      pair: ['ink', 'canvas', 4.5],
      ratio: ratio(inkSeed, canvas),
    };
  }

  const muted = pick(mix(ink, canvas, mode === 'light' ? 0.45 : 0.35), ['muted'], ['muted', 'surface-2', 4.5], 'Второстепенный текст');
  if (typeof muted !== 'string') return muted;

  const line = mix(canvas, ink, 0.14);
  const lineStrong = pick(mix(canvas, ink, 0.45), ['line-strong'], ['line-strong', 'canvas', 3], 'Усиленная граница');
  if (typeof lineStrong !== 'string') return lineStrong;

  const accent = pick(accentSeed, ['accent'], ['accent', 'canvas', 4.5], 'Акцент');
  if (typeof accent !== 'string') return accent;
  palette.accent = accent;

  const onAccent = bestOnAccent(accent);
  if (!satisfiesAll(onAccent, requirementsFor(['on-accent'], palette))) {
    return {
      ok: false,
      error: 'Подпись на кнопке не контрастирует с акцентом — выберите другой акцент.',
      pair: ['on-accent', 'accent', 4.5],
      ratio: ratio(onAccent, accent),
    };
  }

  const accentHover = findContrast(shiftLightness(accent, mode === 'light' ? -0.07 : 0.07), canvas, 4.5) ?? accent;
  let accentSoft = mix(accent, canvas, 0.12);
  for (const weight of [0.12, 0.08, 0.05, 0.03]) {
    const candidate = findBackground(ink, mix(accent, canvas, weight), 4.5);
    if (candidate) {
      accentSoft = candidate;
      break;
    }
  }

  const seeds = STATUS_SEED[mode];
  const dangerSeed = base.danger ? toHex(base.danger) : seeds.danger;
  const warningSeed = base.warning ? toHex(base.warning) : seeds.warning;

  const danger = pick(dangerSeed, ['danger', 'st-blocked', 'ty-bug', 'pr-high'], ['danger', 'surface', 4.5], 'Цвет опасности');
  if (typeof danger !== 'string') return danger;
  const warning = pick(warningSeed, ['warning', 'pr-med'], ['warning', 'surface', 4.5], 'Цвет предупреждения');
  if (typeof warning !== 'string') return warning;
  const success = pick(seeds.success, ['success', 'st-done'], ['success', 'surface', 4.5], 'Цвет успеха');
  if (typeof success !== 'string') return success;
  const review = pick(seeds.review, ['st-review', 'ty-feature'], ['st-review', 'surface', 4.5], 'Цвет проверки');
  if (typeof review !== 'string') return review;
  const archive = pick(seeds.archive, ['st-archive'], ['st-archive', 'surface', 4.5], 'Цвет архива');
  if (typeof archive !== 'string') return archive;
  const typeTask = pick(mix(ink, canvas, 0.65), ['ty-task'], ['ty-task', 'surface', 4.5], 'Тип задачи');
  if (typeof typeTask !== 'string') return typeTask;
  const focus = pick(accent, ['focus'], ['focus-ring', 'canvas', 3], 'Кольцо фокуса');
  if (typeof focus !== 'string') return focus;

  const tokens: TokenMap = {
    canvas,
    surface,
    'surface-2': surface2,
    line,
    'line-strong': lineStrong,
    ink,
    muted,
    accent,
    'accent-hover': accentHover,
    'accent-soft': accentSoft,
    'on-accent': onAccent,
    'st-todo': muted,
    'st-doing': accent,
    'st-review': review,
    'st-blocked': danger,
    'st-done': success,
    'st-archive': archive,
    'ty-bug': danger,
    'ty-feature': review,
    'ty-task': typeTask,
    'pr-high': danger,
    'pr-med': warning,
    'pr-low': muted,
    danger,
    success,
    warning,
    focus,
  };

  const { failures } = verify(tokens);
  const criticalFailures = failures.filter((check) => check.critical);
  if (criticalFailures.length > 0) {
    const first = criticalFailures[0];
    return {
      ok: false,
      error: `Не удалось подобрать контраст для пары ${first.key}.`,
      pair: first.pair,
      ratio: first.ratio,
    };
  }

  const warnings = failures.map((check) => `${check.key}: ${check.ratio.toFixed(2)}:1 (нужно ${check.threshold}:1)`);
  if (canvasWarning) warnings.unshift(canvasWarning);
  return { ok: true, tokens, warnings };
}

/** Unconstrained palette for the editor preview, including failing drafts. */
export function previewTokens(base: ThemeBase, mode: ThemeMode): TokenMap {
  try {
    const canvas = toHex(base.background);
    const ink = toHex(base.text);
    const accent = toHex(base.accent);
    const surface = mix(canvas, WHITE, 0.06);
    const surface2 = mix(surface, mode === 'light' ? '#000000' : WHITE, 0.06);
    const muted = mix(ink, canvas, mode === 'light' ? 0.45 : 0.35);
    const seeds = STATUS_SEED[mode];
    const danger = base.danger ? toHex(base.danger) : seeds.danger;
    const warning = base.warning ? toHex(base.warning) : seeds.warning;
    return {
      canvas,
      surface,
      'surface-2': surface2,
      line: mix(canvas, ink, 0.14),
      'line-strong': mix(canvas, ink, 0.45),
      ink,
      muted,
      accent,
      'accent-hover': shiftLightness(accent, mode === 'light' ? -0.07 : 0.07),
      'accent-soft': mix(accent, canvas, 0.12),
      'on-accent': bestOnAccent(accent),
      'st-todo': muted,
      'st-doing': accent,
      'st-review': seeds.review,
      'st-blocked': danger,
      'st-done': seeds.success,
      'st-archive': seeds.archive,
      'ty-bug': danger,
      'ty-feature': seeds.review,
      'ty-task': mix(ink, canvas, 0.65),
      'pr-high': danger,
      'pr-med': warning,
      'pr-low': muted,
      danger,
      success: seeds.success,
      warning,
      focus: accent,
    };
  } catch {
    const fallback = DEFAULT_BASE[mode];
    const canvas = toHex(fallback.background);
    const ink = toHex(fallback.text);
    const accent = toHex(fallback.accent);
    const surface = mix(canvas, WHITE, 0.06);
    const surface2 = mix(surface, mode === 'light' ? '#000000' : WHITE, 0.06);
    const seeds = STATUS_SEED[mode];
    return {
      canvas,
      surface,
      'surface-2': surface2,
      line: mix(canvas, ink, 0.14),
      'line-strong': mix(canvas, ink, 0.45),
      ink,
      muted: mix(ink, canvas, 0.45),
      accent,
      'accent-hover': accent,
      'accent-soft': mix(accent, canvas, 0.12),
      'on-accent': bestOnAccent(accent),
      'st-todo': mix(ink, canvas, 0.45),
      'st-doing': accent,
      'st-review': seeds.review,
      'st-blocked': seeds.danger,
      'st-done': seeds.success,
      'st-archive': seeds.archive,
      'ty-bug': seeds.danger,
      'ty-feature': seeds.review,
      'ty-task': mix(ink, canvas, 0.65),
      'pr-high': seeds.danger,
      'pr-med': seeds.warning,
      'pr-low': mix(ink, canvas, 0.45),
      danger: seeds.danger,
      success: seeds.success,
      warning: seeds.warning,
      focus: accent,
    };
  }
}

function previewChecks(base: ThemeBase, mode: ThemeMode): PairCheck[] {
  let canvas = WHITE;
  let ink = INK_ON_DARK;
  let accent = WHITE;
  try {
    canvas = toHex(base.background);
    ink = toHex(base.text);
    accent = toHex(base.accent);
  } catch {
    return [];
  }
  const onAccent = bestOnAccent(accent);
  const raw: Record<string, string> = {
    canvas,
    surface: canvas,
    ink,
    accent,
    'on-accent': onAccent,
  };
  return TEXT_PAIRS.map((pair) => {
    const [fg, bg, threshold] = pair;
    const foreground = raw[tokenForPair(fg)];
    const background = raw[tokenForPair(bg)];
    if (!foreground || !background) {
      return { pair, key: pairKey(pair), critical: false, ratio: 0, threshold, pass: true };
    }
    const value = ratio(foreground, background);
    return {
      pair,
      key: pairKey(pair),
      critical: CRITICAL_PAIRS.some((critical) => pairKey(critical) === pairKey(pair)),
      ratio: value,
      threshold,
      pass: value + 1e-9 >= threshold,
    };
  });
}

/** Everything the editor needs for one mode: derivation plus the live table. */
export function analyzeMode(base: ThemeBase, mode: ThemeMode): ModeAnalysis {
  const derivation = deriveMode(base, mode);
  if (!derivation.ok) {
    const checks =
      derivation.pair && typeof derivation.ratio === 'number'
        ? [
            {
              pair: derivation.pair,
              key: pairKey(derivation.pair),
              critical: true,
              ratio: derivation.ratio,
              threshold: derivation.pair[2],
              pass: false,
            },
          ]
        : previewChecks(base, mode);
    return { mode, derivation, checks, blocking: true, advisoryFailures: 0 };
  }
  const { checks } = verify(derivation.tokens);
  return {
    mode,
    derivation,
    checks,
    blocking: false,
    advisoryFailures: checks.filter((check) => !check.pass).length,
  };
}

export function newThemeId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `theme-${uuid.replace(/-/g, '').slice(0, 8)}`;
  return `theme-${Math.random().toString(16).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface ThemeInput {
  name: string;
  base: Record<ThemeMode, ThemeBase>;
}

export type BuildResult = { ok: true; theme: CustomTheme } | { ok: false; error: string };

export function normalizeBase(input: unknown): { ok: true; base: ThemeBase } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Базовые цвета должны быть объектом.' };
  }
  const record = input as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !(BASE_KEYS as readonly string[]).includes(key));
  if (extra.length > 0) return { ok: false, error: `Неизвестные поля цвета: ${extra.join(', ')}.` };

  const base: ThemeBase = { accent: '', background: '', text: '' };
  for (const key of ['accent', 'background', 'text'] as const) {
    const value = record[key];
    if (!isColor(value)) return { ok: false, error: `Цвет «${key}» должен быть hex, rgb() или hsl().` };
    if (String(value).length > MAX_STORED_COLOR) return { ok: false, error: `Цвет «${key}» слишком длинный.` };
    base[key] = toHex(String(value));
  }
  for (const key of ['warning', 'danger'] as const) {
    const value = record[key];
    if (value === undefined || value === null || value === '') continue;
    if (!isColor(value)) return { ok: false, error: `Цвет «${key}» должен быть hex, rgb() или hsl().` };
    if (String(value).length > MAX_STORED_COLOR) return { ok: false, error: `Цвет «${key}» слишком длинный.` };
    base[key] = toHex(String(value));
  }
  return { ok: true, base };
}

export function validateThemeName(name: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof name !== 'string') return { ok: false, error: 'Имя темы должно быть строкой.' };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Имя темы не может быть пустым.' };
  if (trimmed.length > MAX_THEME_NAME) {
    return { ok: false, error: `Имя темы длиннее ${MAX_THEME_NAME} символов.` };
  }
  if (!NAME_RE.test(trimmed)) {
    return { ok: false, error: 'В имени допустимы буквы, цифры, пробел, точка, дефис и подчёркивание.' };
  }
  return { ok: true, name: trimmed };
}

export function buildTheme(input: ThemeInput, options: { id?: string; now?: string } = {}): BuildResult {
  const name = validateThemeName(input.name);
  if (!name.ok) return name;
  const light = normalizeBase(input.base?.light);
  if (!light.ok) return { ok: false, error: `Светлая тема: ${light.error}` };
  const dark = normalizeBase(input.base?.dark);
  if (!dark.ok) return { ok: false, error: `Тёмная тема: ${dark.error}` };

  const derivedLight = deriveMode(light.base, 'light');
  if (!derivedLight.ok) return { ok: false, error: `Светлая тема: ${derivedLight.error}` };
  const derivedDark = deriveMode(dark.base, 'dark');
  if (!derivedDark.ok) return { ok: false, error: `Тёмная тема: ${derivedDark.error}` };

  const stamp = options.now ?? nowIso();
  return {
    ok: true,
    theme: {
      id: options.id ?? newThemeId(),
      name: name.name,
      base: { light: light.base, dark: dark.base },
      tokens: { light: derivedLight.tokens, dark: derivedDark.tokens },
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}

function parseTokens(value: unknown): { ok: true; tokens: TokenMap } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Токены темы должны быть объектом.' };
  }
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !(COLOR_TOKENS as readonly string[]).includes(key));
  if (extra.length > 0) return { ok: false, error: `Неизвестные токены: ${extra.slice(0, 3).join(', ')}.` };
  const tokens = {} as TokenMap;
  for (const key of COLOR_TOKENS) {
    const entry = record[key];
    if (typeof entry !== 'string' || !HEX6_RE.test(entry)) {
      return { ok: false, error: `Токен «${key}» должен быть #rrggbb.` };
    }
    tokens[key] = entry;
  }
  return { ok: true, tokens };
}

export function parseTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter(
    (key) => !['id', 'name', 'base', 'tokens', 'createdAt', 'updatedAt'].includes(key),
  );
  if (extra.length > 0) return null;
  if (typeof record.id !== 'string' || !ID_RE.test(record.id)) return null;
  const name = validateThemeName(record.name);
  if (!name.ok) return null;
  const base = record.base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return null;
  const baseRecord = base as Record<string, unknown>;
  if (Object.keys(baseRecord).some((key) => key !== 'light' && key !== 'dark')) return null;
  const light = normalizeBase(baseRecord.light);
  if (!light.ok) return null;
  const dark = normalizeBase(baseRecord.dark);
  if (!dark.ok) return null;
  const tokens = record.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  const tokenRecord = tokens as Record<string, unknown>;
  if (Object.keys(tokenRecord).some((key) => key !== 'light' && key !== 'dark')) return null;
  const lightTokens = parseTokens(tokenRecord.light);
  if (!lightTokens.ok) return null;
  const darkTokens = parseTokens(tokenRecord.dark);
  if (!darkTokens.ok) return null;
  for (const stamp of ['createdAt', 'updatedAt'] as const) {
    if (typeof record[stamp] !== 'string' || String(record[stamp]).length > 32) return null;
  }
  return {
    id: record.id,
    name: name.name,
    base: { light: light.base, dark: dark.base },
    tokens: { light: lightTokens.tokens, dark: darkTokens.tokens },
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
  };
}

export function parseThemeStore(raw: unknown): CustomThemeStore | null {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_STORE_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'version' && key !== 'themes')) return null;
  if (record.version !== CUSTOM_STORE_VERSION) return null;
  if (!Array.isArray(record.themes)) return null;
  if (record.themes.length > MAX_CUSTOM_THEMES) return null;
  const themes: CustomTheme[] = [];
  const ids = new Set<string>();
  for (const entry of record.themes) {
    const theme = parseTheme(entry);
    if (!theme) return null;
    if (ids.has(theme.id)) return null;
    ids.add(theme.id);
    themes.push(theme);
  }
  return { version: CUSTOM_STORE_VERSION, themes };
}

/** Accepts v1 stores and a legacy bare array of themes (pre-version storage). */
export function migrateStore(raw: unknown): CustomThemeStore | null {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_STORE_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return parseThemeStore({ version: CUSTOM_STORE_VERSION, themes: value });
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version === undefined) {
    return parseThemeStore({ version: CUSTOM_STORE_VERSION, themes: record.themes ?? [] });
  }
  return parseThemeStore(value);
}

type ReadableStorage = Pick<Storage, 'getItem'> | null | undefined;
type WritableStorage = (Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'removeItem'>>) | null | undefined;

export function readCustomThemes(storage: ReadableStorage): CustomThemeStore {
  try {
    const stored = migrateStore(storage?.getItem(CUSTOM_STORE_KEY));
    return stored ?? { version: CUSTOM_STORE_VERSION, themes: [] };
  } catch {
    return { version: CUSTOM_STORE_VERSION, themes: [] };
  }
}

export function writeCustomThemes(storage: WritableStorage, store: CustomThemeStore): boolean {
  try {
    storage?.setItem(CUSTOM_STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function readActiveCustomId(storage: ReadableStorage): string | null {
  try {
    const value = storage?.getItem(CUSTOM_ACTIVE_KEY);
    return typeof value === 'string' && ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeActiveCustomId(storage: WritableStorage, id: string | null): void {
  try {
    if (id) storage?.setItem(CUSTOM_ACTIVE_KEY, id);
    else storage?.removeItem?.(CUSTOM_ACTIVE_KEY);
  } catch {
    // blocked storage: the in-memory choice still applies for this tab
  }
}

export const EXPORT_FORMAT = 'mcp-custom-theme';

export function exportTheme(theme: CustomTheme): string {
  return JSON.stringify({ format: EXPORT_FORMAT, version: CUSTOM_STORE_VERSION, theme }, null, 2);
}

export function importThemeJson(
  text: string,
  options: { id?: string; now?: string } = {},
): BuildResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'Пустой JSON.' };
  }
  if (text.length > MAX_STORE_BYTES) return { ok: false, error: 'Файл темы слишком большой.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Это не JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ожидается объект темы.' };
  }
  const record = parsed as Record<string, unknown>;
  const candidate = record.format === EXPORT_FORMAT ? record.theme : parsed;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { ok: false, error: 'В файле нет объекта theme.' };
  }
  const theme = candidate as Record<string, unknown>;
  const base = theme.base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return { ok: false, error: 'В теме нет базовых цветов (base).' };
  }
  const baseRecord = base as Record<string, unknown>;
  return buildTheme(
    {
      name: typeof theme.name === 'string' ? theme.name : 'Imported theme',
      base: {
        light: baseRecord.light as ThemeBase,
        dark: baseRecord.dark as ThemeBase,
      },
    },
    options,
  );
}

export interface ThemeRootLike {
  setAttribute(name: string, value: string): void;
  style?: {
    setProperty(name: string, value: string): void;
    removeProperty?(name: string): void;
    colorScheme?: string;
  };
}

export function clearCustomTheme(root: ThemeRootLike): void {
  if (root.style?.removeProperty) {
    for (const token of COLOR_TOKENS) root.style.removeProperty(`--${token}`);
  }
  root.setAttribute('data-theme', DEFAULT_THEME);
}

/** Apply a stored theme; on any problem fall back to the default palette. */
export function applyCustomTheme(
  root: ThemeRootLike,
  theme: unknown,
  mode: ThemeMode,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseTheme(theme);
  if (!parsed) {
    clearCustomTheme(root);
    return { ok: false, error: 'Тема повреждена — возвращена палитра по умолчанию.' };
  }
  const tokens = parsed.tokens[mode];
  const entries = COLOR_TOKENS.map((token) => [token, tokens[token]] as const);
  const invalid = entries.find(([, value]) => !HEX6_RE.test(value));
  if (invalid) {
    clearCustomTheme(root);
    return { ok: false, error: `Токен «${invalid[0]}» некорректен — возвращена палитра по умолчанию.` };
  }
  if (!root.style) {
    clearCustomTheme(root);
    return { ok: false, error: 'Окружение не поддерживает CSS-переменные.' };
  }
  for (const [token, value] of entries) root.style.setProperty(`--${token}`, value);
  root.setAttribute('data-theme', CUSTOM_THEME_NAME);
  root.setAttribute('data-mode', mode);
  root.style.colorScheme = mode;
  return { ok: true };
}
