/**
 * UI-13 regression tests: list payloads must be normalized to items without
 * `content`. Treating a `knowledge_list` entry as a full document crashed
 * /knowledge on open (F-01) and on search (F-02).
 */

import { describe, it, expect } from 'vitest';
import { normalizeKnowledgeItems, toKnowledgeListItem } from './knowledge';

describe('toKnowledgeListItem', () => {
  it('strips content from a full document', () => {
    const item = toKnowledgeListItem({
      id: 'doc-1',
      title: 'Doc',
      content: '# secret body',
      tags: ['a', 1, 'b'],
      type: 'note',
      project: 'mcp',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });

    expect(item).not.toBeNull();
    expect(item).not.toHaveProperty('content');
    expect(item).toMatchObject({
      id: 'doc-1',
      title: 'Doc',
      tags: ['a', 'b'],
      type: 'note',
      project: 'mcp',
    });
  });

  it('keeps the search snippet but never content', () => {
    const item = toKnowledgeListItem({
      id: 'doc-2',
      title: 'Search hit',
      content: undefined,
      snippet: '…quantum flux…',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    });

    expect(item).not.toBeNull();
    expect(item).not.toHaveProperty('content');
    expect(item?.snippet).toBe('…quantum flux…');
  });

  it('falls back to the id when title is missing and tolerates missing dates', () => {
    const item = toKnowledgeListItem({ id: 'doc-3' });
    expect(item).toMatchObject({ id: 'doc-3', title: 'doc-3', createdAt: '', updatedAt: '' });
  });

  it('rejects unusable payloads instead of throwing', () => {
    expect(toKnowledgeListItem(null)).toBeNull();
    expect(toKnowledgeListItem(undefined)).toBeNull();
    expect(toKnowledgeListItem('doc')).toBeNull();
    expect(toKnowledgeListItem({ title: 'no id' })).toBeNull();
  });
});

describe('normalizeKnowledgeItems', () => {
  it('drops invalid entries and preserves order', () => {
    const items = normalizeKnowledgeItems([
      { id: 'a', title: 'A' },
      null,
      { title: 'no id' },
      { id: 'b', title: 'B', content: 'x' },
    ]);

    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(items[1]).not.toHaveProperty('content');
  });

  it('returns an empty array for non-array payloads', () => {
    expect(normalizeKnowledgeItems(undefined)).toEqual([]);
    expect(normalizeKnowledgeItems({ data: [] })).toEqual([]);
  });
});
