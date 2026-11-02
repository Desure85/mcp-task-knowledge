import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from './theme';
import { buildTheme } from './custom-theme';
import { COLOR_TOKENS, CUSTOM_ACTIVE_KEY, CUSTOM_STORE_KEY } from './theme-tokens';

interface RunOptions {
  dark?: boolean;
  throwOnRead?: boolean;
}

function run(storage: Record<string, string>, options: RunOptions = {}) {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const root = {
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
    style: {
      colorScheme: '',
      setProperty: (name: string, value: string) => {
        props[name] = value;
      },
    },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (options.throwOnRead) throw new Error('blocked');
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
    },
  };
  const window = { matchMedia: () => ({ matches: options.dark === true }) };
  const document = { documentElement: root };
  new Function('localStorage', 'window', 'document', THEME_INIT_SCRIPT)(localStorage, window, document);
  return { attrs, props, root };
}

function storedTheme() {
  const built = buildTheme(
    {
      name: 'Pre-paint',
      base: {
        light: { accent: '#0e6b66', background: '#f7f7f4', text: '#16181c' },
        dark: { accent: '#5ed3c6', background: '#121417', text: '#e9ebee' },
      },
    },
    { id: 'theme-prepaint', now: '2026-10-31T00:00:00.000Z' },
  );
  if (!built.ok) throw new Error(built.error);
  return built.theme;
}

describe('UI-33 pre-paint script', () => {
  it('paints the default palette when nothing is stored', () => {
    const { attrs, props, root } = run({});
    expect(attrs['data-theme']).toBe('indigo');
    expect(attrs['data-mode']).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(Object.keys(props)).toEqual([]);
  });

  it('resolves system mode before paint', () => {
    expect(run({}, { dark: true }).attrs['data-mode']).toBe('dark');
    expect(run({ 'mcp.mode': 'dark' }, { dark: false }).attrs['data-mode']).toBe('dark');
  });

  it('ignores an unknown palette value', () => {
    expect(run({ 'mcp.theme': 'neon' }).attrs['data-theme']).toBe('indigo');
  });

  it('applies a stored custom theme without the derivation', () => {
    const theme = storedTheme();
    const storage = {
      'mcp.theme': 'indigo',
      'mcp.mode': 'light',
      [CUSTOM_ACTIVE_KEY]: theme.id,
      [CUSTOM_STORE_KEY]: JSON.stringify({ version: 1, themes: [theme] }),
    };
    const { attrs, props, root } = run(storage);
    expect(attrs['data-theme']).toBe('custom');
    expect(attrs['data-mode']).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    for (const token of COLOR_TOKENS) expect(props[`--${token}`]).toBe(theme.tokens.light[token]);
  });

  it('applies the dark token set in dark mode', () => {
    const theme = storedTheme();
    const { attrs, props } = run({
      'mcp.mode': 'dark',
      [CUSTOM_ACTIVE_KEY]: theme.id,
      [CUSTOM_STORE_KEY]: JSON.stringify({ version: 1, themes: [theme] }),
    });
    expect(attrs['data-mode']).toBe('dark');
    expect(props['--accent']).toBe(theme.tokens.dark.accent);
  });

  it('falls back to the palette for corrupt JSON, unknown version or a missing id', () => {
    const theme = storedTheme();
    const corrupt = run({ 'mcp.theme': 'copper', [CUSTOM_ACTIVE_KEY]: theme.id, [CUSTOM_STORE_KEY]: '{broken' });
    expect(corrupt.attrs['data-theme']).toBe('copper');
    expect(Object.keys(corrupt.props)).toEqual([]);

    const future = run({
      [CUSTOM_ACTIVE_KEY]: theme.id,
      [CUSTOM_STORE_KEY]: JSON.stringify({ version: 99, themes: [theme] }),
    });
    expect(future.attrs['data-theme']).toBe('indigo');

    const missing = run({
      [CUSTOM_ACTIVE_KEY]: 'theme-absent',
      [CUSTOM_STORE_KEY]: JSON.stringify({ version: 1, themes: [theme] }),
    });
    expect(missing.attrs['data-theme']).toBe('indigo');
  });

  it('rejects a tampered token instead of painting it', () => {
    const theme = storedTheme();
    const tampered = JSON.parse(JSON.stringify(theme));
    tampered.tokens.light.accent = 'red';
    const { attrs, props } = run({
      'mcp.theme': 'petrol',
      [CUSTOM_ACTIVE_KEY]: theme.id,
      [CUSTOM_STORE_KEY]: JSON.stringify({ version: 1, themes: [tampered] }),
    });
    expect(attrs['data-theme']).toBe('petrol');
    expect(Object.keys(props)).toEqual([]);
  });

  it('falls back to the default palette when localStorage throws', () => {
    const { attrs, root } = run({}, { throwOnRead: true });
    expect(attrs['data-theme']).toBe('indigo');
    expect(attrs['data-mode']).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });
});
