import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { buildTheme, parseThemeStore, DEFAULT_BASE, type CustomTheme } from './custom-theme';
import {
  HUE_COLOR_TOKENS,
  THEME_COLOR_TOKENS,
} from './theme-pairs';
import { STATUS_COLOR_TOKENS, TYPE_COLOR_TOKENS, STATUS_COLOR_LABELS } from './project-settings';
import { statusDotClass } from './board';
import { typeDotClass } from './board-lanes';

describe('UI-40 palette tokens', () => {
  it('keeps the six legacy status names and adds hue/theme tokens', () => {
    for (const legacy of ['st-todo', 'st-doing', 'st-review', 'st-blocked', 'st-done', 'st-archive']) {
      expect(STATUS_COLOR_TOKENS).toContain(legacy);
      expect(STATUS_COLOR_LABELS[legacy]).toBeTruthy();
    }
    for (const token of [...HUE_COLOR_TOKENS, ...THEME_COLOR_TOKENS]) {
      expect(STATUS_COLOR_TOKENS).toContain(token);
      expect(TYPE_COLOR_TOKENS).toContain(token);
      expect(STATUS_COLOR_LABELS[token]).toBeTruthy();
    }
  });

  it('resolves new status and type tokens to generated background classes', () => {
    expect(statusDotClass({ color: 'st-slate', category: 'todo' })).toBe('bg-st-slate');
    expect(statusDotClass({ color: 'info', category: 'in_progress' })).toBe('bg-info');
    expect(typeDotClass({ color: 'st-teal' })).toBe('bg-st-teal');
    expect(typeDotClass({ color: 'success' })).toBe('bg-success');
    expect(typeDotClass({ color: 'not-a-token' })).toBe('bg-ty-task');
  });

  it.each(['light', 'dark'] as const)('derives AA hue tokens in a custom theme (%s)', (mode) => {
    const built = buildTheme({ name: 'UI40 Palette', base: { light: DEFAULT_BASE.light, dark: DEFAULT_BASE.dark } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const tokens = built.theme.tokens[mode];
    for (const token of [...HUE_COLOR_TOKENS, 'info']) {
      expect(tokens[token as keyof typeof tokens]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(tokens[token as keyof typeof tokens], tokens.surface)).toBeGreaterThanOrEqual(4.5 - 1e-9);
    }
  });

  it('reads pre-UI-40 custom themes that lack the new token keys', () => {
    const built = buildTheme({ name: 'Old Theme', base: { light: DEFAULT_BASE.light, dark: DEFAULT_BASE.dark } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const old: CustomTheme = JSON.parse(JSON.stringify(built.theme));
    for (const mode of ['light', 'dark'] as const) {
      for (const token of [...HUE_COLOR_TOKENS, 'info']) delete old.tokens[mode][token as keyof typeof old.tokens.light];
    }
    const parsed = parseThemeStore({ version: 1, themes: [old] });
    expect(parsed?.themes).toHaveLength(1);
    for (const token of [...HUE_COLOR_TOKENS, 'info']) {
      expect(parsed!.themes[0].tokens.light[token as keyof typeof old.tokens.light]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
