/**
 * Graph colours are read from the same semantic tokens as the rest of the UI.
 * The SVG is not styled by Tailwind classes, so resolve the tokens at runtime
 * and re-read them whenever the theme axes change on <html>.
 */

export type GraphNodeType = 'entity' | 'fact';

export interface GraphPalette {
  nodes: Record<GraphNodeType, string>;
  edge: string;
  nodeStroke: string;
  selectedStroke: string;
  label: string;
}

export const GRAPH_COLOR_TOKENS = {
  nodes: {
    entity: '--accent',
    fact: '--st-done',
  },
  edge: '--line-strong',
  nodeStroke: '--surface',
  selectedStroke: '--ink',
  label: '--muted',
} as const;

const FALLBACK = 'currentColor';

export function readGraphPalette(read: (token: string) => string): GraphPalette {
  const pick = (token: string) => read(token).trim() || FALLBACK;
  return {
    nodes: {
      entity: pick(GRAPH_COLOR_TOKENS.nodes.entity),
      fact: pick(GRAPH_COLOR_TOKENS.nodes.fact),
    },
    edge: pick(GRAPH_COLOR_TOKENS.edge),
    nodeStroke: pick(GRAPH_COLOR_TOKENS.nodeStroke),
    selectedStroke: pick(GRAPH_COLOR_TOKENS.selectedStroke),
    label: pick(GRAPH_COLOR_TOKENS.label),
  };
}

export function readCssVariable(token: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(token);
}

export type ThemeObserver = {
  observe(target: Element, options: MutationObserverInit): void;
  disconnect(): void;
};

export type ThemeObserverCtor = new (callback: MutationCallback) => ThemeObserver;

/**
 * Watch only the two theme attributes. ThemeManager changes them when the
 * user switches palette/mode (including a live `system` preference change).
 */
export function observeThemeAttributes(
  target: Element,
  onChange: () => void,
  ObserverCtor: ThemeObserverCtor = MutationObserver as unknown as ThemeObserverCtor,
): () => void {
  const observer = new ObserverCtor((records) => {
    if (records.some((record) => record.attributeName === 'data-theme' || record.attributeName === 'data-mode')) {
      onChange();
    }
  });
  observer.observe(target, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
  return () => observer.disconnect();
}
