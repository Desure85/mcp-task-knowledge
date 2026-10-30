/**
 * Normalization for knowledge API payloads (UI-13).
 *
 * `knowledge_list` returns frontmatter only (no `content`), while
 * `search_knowledge` returns the same fields plus an optional `snippet` and
 * may omit `content`. The UI list must never treat an item as a full document:
 * doing so previously crashed the page on `content.replace`/`content.toLowerCase`
 * (F-01/F-02). `toKnowledgeListItem` is the single boundary that strips
 * `content` and fills safe defaults for malformed/legacy payloads.
 */

import type { KnowledgeListItem } from './api-client';

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Map one API item to a safe list item; returns null when there is no usable id. */
export function toKnowledgeListItem(raw: unknown): KnowledgeListItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = stringOr(item.id, '');
  if (!id) return null;

  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === 'string')
    : undefined;

  return {
    id,
    title: stringOr(item.title, id),
    ...(tags ? { tags } : {}),
    ...(typeof item.type === 'string' ? { type: item.type } : {}),
    ...(typeof item.source === 'string' ? { source: item.source } : {}),
    ...(typeof item.parentId === 'string' ? { parentId: item.parentId } : {}),
    ...(typeof item.project === 'string' ? { project: item.project } : {}),
    createdAt: stringOr(item.createdAt, ''),
    updatedAt: stringOr(item.updatedAt, ''),
    ...(typeof item.snippet === 'string' ? { snippet: item.snippet } : {}),
  };
}

/** Map an API array, dropping unusable entries instead of throwing. */
export function normalizeKnowledgeItems(raw: unknown): KnowledgeListItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => toKnowledgeListItem(item))
    .filter((item): item is KnowledgeListItem => item !== null);
}
