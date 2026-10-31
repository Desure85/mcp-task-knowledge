import { describe, it, expect, vi } from 'vitest';
import {
  GRAPH_COLOR_TOKENS,
  observeThemeAttributes,
  readGraphPalette,
  type ThemeObserverCtor,
} from './graph-theme';

describe('graph theme palette', () => {
  it('resolves every graph colour from a semantic token', () => {
    const values: Record<string, string> = {
      '--accent': '#111111',
      '--st-done': '#222222',
      '--line-strong': '#333333',
      '--surface': '#444444',
      '--ink': '#555555',
      '--muted': '#666666',
      '--st-archive': '#777777',
      '--focus': '#888888',
    };
    const palette = readGraphPalette((token) => values[token] ?? '');

    expect(GRAPH_COLOR_TOKENS.nodes).toEqual({ entity: '--accent', fact: '--st-done' });
    expect(GRAPH_COLOR_TOKENS.superseded).toBe('--st-archive');
    expect(GRAPH_COLOR_TOKENS.edgeReplaces).toBe('--st-archive');
    expect(GRAPH_COLOR_TOKENS.highlight).toBe('--focus');
    expect(palette.nodes).toEqual({ entity: '#111111', fact: '#222222' });
    expect(palette.edge).toBe('#333333');
    expect(palette.nodeStroke).toBe('#444444');
    expect(palette.selectedStroke).toBe('#555555');
    expect(palette.label).toBe('#666666');
    expect(palette.superseded).toBe('#777777');
    expect(palette.edgeReplaces).toBe('#777777');
    expect(palette.highlight).toBe('#888888');
  });

  it('falls back safely when a token is missing', () => {
    expect(readGraphPalette(() => '').nodes).toEqual({
      entity: 'currentColor',
      fact: 'currentColor',
    });
  });

  it('changes colours when the resolved token values change', () => {
    const light = readGraphPalette((token) => (token === '--accent' ? '#111111' : '#222222'));
    const dark = readGraphPalette((token) => (token === '--accent' ? '#eeeeee' : '#dddddd'));
    expect(dark.nodes.entity).not.toBe(light.nodes.entity);
    expect(dark.nodes.fact).not.toBe(light.nodes.fact);
  });
});

describe('graph theme observer', () => {
  it('re-reads colours when data-theme or data-mode changes, and disconnects', () => {
    let callback: MutationCallback = () => {};
    let observed: { target: Element; options: MutationObserverInit } | null = null;
    let disconnected = false;

    class FakeObserver {
      constructor(cb: MutationCallback) {
        callback = cb;
      }
      observe(target: Element, options: MutationObserverInit) {
        observed = { target, options };
      }
      disconnect() {
        disconnected = true;
      }
    }

    const target = {} as Element;
    const onChange = vi.fn();
    const cleanup = observeThemeAttributes(
      target,
      onChange,
      FakeObserver as unknown as ThemeObserverCtor,
    );

    expect(observed).not.toBeNull();
    expect(observed!.target).toBe(target);
    expect(observed!.options.attributes).toBe(true);
    expect(observed!.options.attributeFilter).toEqual(['data-theme', 'data-mode']);

    callback([{ attributeName: 'data-theme' } as MutationRecord], {} as MutationObserver);
    expect(onChange).toHaveBeenCalledTimes(1);

    callback([{ attributeName: 'data-mode' } as MutationRecord], {} as MutationObserver);
    expect(onChange).toHaveBeenCalledTimes(2);

    callback([{ attributeName: 'class' } as MutationRecord], {} as MutationObserver);
    expect(onChange).toHaveBeenCalledTimes(2);

    cleanup();
    expect(disconnected).toBe(true);
  });
});
