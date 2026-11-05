import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BASE,
  analyzeMode,
  applyCustomTheme,
  buildTheme,
  clearCustomTheme,
  deriveMode,
  exportTheme,
  importThemeJson,
  migrateStore,
  normalizeBase,
  parseTheme,
  parseThemeStore,
  previewTokens,
  readCustomThemes,
  validateThemeName,
  writeCustomThemes,
  type CustomTheme,
  type ThemeBase,
  type ThemeMode,
} from './custom-theme';
import { contrastRatio, hslToRgb, toHex } from './contrast';
import { TEXT_PAIRS, tokenForPair } from './theme-pairs';
import { COLOR_TOKENS, HEX6_RE, MAX_CUSTOM_THEMES } from './theme-tokens';

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBase(seed: number): ThemeBase {
  const random = mulberry32(seed);
  const color = (hueMin: number, hueMax: number, lightMin: number, lightMax: number) => {
    const h = hueMin + random() * (hueMax - hueMin);
    const s = 0.15 + random() * 0.75;
    const l = lightMin + random() * (lightMax - lightMin);
    return toHex(hslToRgb({ h, s, l }));
  };
  return {
    accent: color(0, 360, 0.35, 0.65),
    background: color(0, 360, 0.05, 0.98),
    text: color(0, 360, 0.05, 0.98),
  };
}

const VALID_BASE: Record<ThemeMode, ThemeBase> = {
  light: { accent: '#0e6b66', background: '#f7f7f4', text: '#16181c' },
  dark: { accent: '#5ed3c6', background: '#121417', text: '#e9ebee' },
};

function themeFixture(overrides: Partial<CustomTheme> = {}): CustomTheme {
  const built = buildTheme({ name: 'Fixture', base: VALID_BASE }, { id: 'theme-fixture', now: '2026-10-31T00:00:00.000Z' });
  if (!built.ok) throw new Error(built.error);
  return { ...built.theme, ...overrides };
}

function fakeRoot() {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  return {
    attrs,
    props,
    root: {
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      style: {
        colorScheme: '',
        setProperty: (name: string, value: string) => {
          props[name] = value;
        },
        removeProperty: (name: string) => {
          delete props[name];
        },
      },
    },
  };
}

describe('UI-33 derivation: AA by construction', () => {
  it('keeps every pair for 20 deterministic palettes in both modes', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 20; seed += 1) {
      const base = randomBase(seed);
      for (const mode of ['light', 'dark'] as ThemeMode[]) {
        const result = deriveMode(base, mode);
        if (!result.ok) {
          failures.push(`seed ${seed}/${mode}: ${result.error}`);
          continue;
        }
        for (const pair of TEXT_PAIRS) {
          const [fg, bg, threshold] = pair;
          const value = contrastRatio(
            result.tokens[tokenForPair(fg) as keyof typeof result.tokens],
            result.tokens[tokenForPair(bg) as keyof typeof result.tokens],
          );
          if (value + 1e-9 < threshold) failures.push(`seed ${seed}/${mode} ${fg}/${bg} = ${value.toFixed(2)}`);
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('derives for a gray accent and for near-white / near-black backgrounds', () => {
    const cases: ThemeBase[] = [
      { accent: '#808080', background: '#ffffff', text: '#111111' },
      { accent: '#4f46e5', background: '#fefefe', text: '#101010' },
      { accent: '#8b87ff', background: '#010101', text: '#f5f5f5' },
    ];
    for (const base of cases) {
      for (const mode of ['light', 'dark'] as ThemeMode[]) {
        expect(deriveMode(base, mode).ok, `${base.accent} / ${base.background} / ${mode}`).toBe(true);
      }
    }
  });

  it('refuses an accent that equals the background', () => {
    const base: ThemeBase = { accent: '#123456', background: '#123456', text: '#ffffff' };
    const result = deriveMode(base, 'light');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Акцент/);
    expect(result.pair?.[0]).toBe('accent');
    expect(result.ratio).toBeCloseTo(1, 5);
  });

  it('reports a failing draft as blocking with the failing pair', () => {
    const analysis = analyzeMode({ accent: '#123456', background: '#123456', text: '#ffffff' }, 'light');
    expect(analysis.blocking).toBe(true);
    expect(analysis.checks).toHaveLength(1);
    expect(analysis.checks[0].pass).toBe(false);
  });

  it('normalizes rgb() and hsl() input to hex tokens', () => {
    const built = buildTheme({
      name: 'Formats',
      base: {
        light: { accent: 'rgb(79, 70, 229)', background: 'hsl(0 0% 98%)', text: 'rgba(20, 23, 28, 0.9)' },
        dark: VALID_BASE.dark,
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.theme.base.light.accent).toBe('#4f46e5');
    for (const token of COLOR_TOKENS) expect(built.theme.tokens.light[token]).toMatch(HEX6_RE);
  });

  it('preview tokens never throw on invalid input', () => {
    const tokens = previewTokens({ accent: 'nope', background: 'x', text: 'y' }, 'light');
    for (const token of COLOR_TOKENS) expect(tokens[token]).toMatch(HEX6_RE);
  });
});

describe('UI-33 validation: strict colour schema', () => {
  const injections = [
    'url(javascript:alert(1))',
    'expression(alert(1))',
    'red',
    '#12',
    '#ffffffff00',
    'rgb(999,0,0)',
    'hsl(0 200% 50%)',
    'var(--x)',
    '#fff; background: url(x)',
  ];

  it('rejects CSS injection and out-of-range values', () => {
    for (const value of injections) {
      const built = buildTheme({
        name: 'Bad',
        base: { light: { accent: value, background: '#ffffff', text: '#111111' }, dark: VALID_BASE.dark },
      });
      expect(built.ok, value).toBe(false);
    }
  });

  it('rejects non-string and oversized values', () => {
    expect(normalizeBase({ accent: 123, background: '#ffffff', text: '#111111' }).ok).toBe(false);
    expect(normalizeBase({ accent: '#ffffff', background: '#ffffff', text: '#111111', shine: '#000000' }).ok).toBe(false);
    const long = `#${'a'.repeat(60)}`;
    expect(normalizeBase({ accent: long, background: '#ffffff', text: '#111111' }).ok).toBe(false);
  });

  it('validates theme names', () => {
    expect(validateThemeName('').ok).toBe(false);
    expect(validateThemeName('x'.repeat(41)).ok).toBe(false);
    expect(validateThemeName('line\nbreak').ok).toBe(false);
    expect(validateThemeName('<script>').ok).toBe(false);
    expect(validateThemeName('Петроль Arctic-2').ok).toBe(true);
  });

  it('rejects unknown tokens in a stored theme', () => {
    const theme = themeFixture();
    const tampered = {
      ...theme,
      tokens: { ...theme.tokens, light: { ...theme.tokens.light, evil: '#ffffff' } },
    };
    expect(parseTheme(tampered)).toBeNull();
  });

  it('rejects non-hex tokens and extra store keys', () => {
    const theme = themeFixture();
    const badToken = { ...theme, tokens: { ...theme.tokens, light: { ...theme.tokens.light, accent: 'red' } } };
    expect(parseTheme(badToken)).toBeNull();
    expect(parseThemeStore({ version: 1, themes: [theme], extra: true })).toBeNull();
    expect(parseThemeStore({ version: 1, themes: new Array(MAX_CUSTOM_THEMES + 1).fill(theme) })).toBeNull();
    expect(parseThemeStore('{broken')).toBeNull();
  });
});

describe('UI-33 store: migration and storage failures', () => {
  it('round-trips export and import', () => {
    const theme = themeFixture();
    const imported = importThemeJson(exportTheme(theme), { id: 'theme-copy', now: '2026-10-31T00:00:00.000Z' });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.theme.name).toBe(theme.name);
    expect(imported.theme.base).toEqual(theme.base);
    expect(imported.theme.tokens).toEqual(theme.tokens);
    expect(imported.theme.id).toBe('theme-copy');
  });

  it('rejects a malformed import', () => {
    expect(importThemeJson('not json').ok).toBe(false);
    expect(importThemeJson('[]').ok).toBe(false);
    expect(importThemeJson('{"format":"mcp-custom-theme","version":1}').ok).toBe(false);
    expect(importThemeJson(JSON.stringify({ name: 'X', base: { light: { accent: 'red' } } })).ok).toBe(false);
  });

  it('migrates a legacy bare array and rejects an unknown version', () => {
    const theme = themeFixture();
    expect(migrateStore([theme])?.themes).toHaveLength(1);
    expect(migrateStore({ version: 99, themes: [] })).toBeNull();
    expect(migrateStore({ themes: [theme] })?.version).toBe(1);
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readCustomThemes(blocked).themes).toEqual([]);
    expect(writeCustomThemes(blocked, { version: 1, themes: [] })).toBe(false);
  });
});

describe('UI-33 apply and rollback', () => {
  it('applies every token and marks the root as custom', () => {
    const { root, attrs, props } = fakeRoot();
    const result = applyCustomTheme(root, themeFixture(), 'light');
    expect(result.ok).toBe(true);
    expect(attrs['data-theme']).toBe('custom');
    for (const token of COLOR_TOKENS) expect(props[`--${token}`]).toMatch(HEX6_RE);
  });

  it('applies the requested mode and marks data-mode', () => {
    const { root, props, attrs } = fakeRoot();
    const theme = themeFixture();
    applyCustomTheme(root, theme, 'dark');
    expect(props['--accent']).toBe(theme.tokens.dark.accent);
    expect(attrs['data-mode']).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('switches tokens and mode together when the mode changes', () => {
    const { root, props, attrs } = fakeRoot();
    const theme = themeFixture();
    applyCustomTheme(root, theme, 'light');
    expect(props['--accent']).toBe(theme.tokens.light.accent);
    applyCustomTheme(root, theme, 'dark');
    expect(props['--accent']).toBe(theme.tokens.dark.accent);
    expect(attrs['data-mode']).toBe('dark');
  });

  it('rejects a tampered theme and restores the default palette', () => {
    const { root, attrs, props } = fakeRoot();
    const theme = themeFixture();
    const tampered = { ...theme, tokens: { ...theme.tokens, light: { ...theme.tokens.light, accent: 'red' } } };
    const result = applyCustomTheme(root, tampered, 'light');
    expect(result.ok).toBe(false);
    expect(attrs['data-theme']).toBe('indigo');
    expect(Object.keys(props)).toEqual([]);
  });

  it('clears custom properties', () => {
    const { root, attrs, props } = fakeRoot();
    applyCustomTheme(root, themeFixture(), 'light');
    clearCustomTheme(root);
    expect(attrs['data-theme']).toBe('indigo');
    expect(Object.keys(props)).toEqual([]);
  });

  it('re-derives tokens when building, so stored tokens cannot drift', () => {
    const theme = themeFixture();
    const rebuilt = buildTheme({ name: theme.name, base: theme.base }, { id: theme.id });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.theme.tokens).toEqual(theme.tokens);
    expect(rebuilt.theme.base).toEqual(theme.base);
  });

  it('uses the default base for new drafts', () => {
    expect(DEFAULT_BASE.light.background).toMatch(HEX6_RE);
    expect(DEFAULT_BASE.dark.text).toMatch(HEX6_RE);
  });
});

describe('accent-soft is a readable tint (selected row)', () => {
  const cases: Array<[string, string, string, 'light' | 'dark']> = [
    ['#e64c4c', '#ffffff', '#14171c', 'light'],
    ['#e64c4c', '#101216', '#e9ebf0', 'dark'],
    ['#2563eb', '#e8eefc', '#0a1530', 'light'],
    ['#22c55e', '#0b1f14', '#e6f4ea', 'dark'],
  ];
  it.each(cases)('accent %s on %s: tint differs from canvas and passes AA for accent and ink', (accent, background, text, mode) => {
    const derivation = deriveMode({ accent, background, text }, mode);
    expect(derivation.ok).toBe(true);
    if (!derivation.ok) return;
    const t = derivation.tokens;
    expect(t['accent-soft']).not.toBe(t.canvas);
    expect(contrastRatio(t.accent, t['accent-soft'])).toBeGreaterThanOrEqual(4.5 - 1e-9);
    expect(contrastRatio(t.ink, t['accent-soft'])).toBeGreaterThanOrEqual(4.5 - 1e-9);
  });
});
