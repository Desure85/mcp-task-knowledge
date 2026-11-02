import { describe, it, expect, vi } from 'vitest';
import type { ProjectStatus } from './api-client';
import {
  BOARD_PREFS_PREFIX,
  COLUMN_WIDTH,
  COLLAPSED_WIDTH,
  allowedTargets,
  activeStatuses,
  boardColumns,
  boardPrefsKey,
  isAllowedTarget,
  orderStatuses,
  overflowCues,
  readBoardPrefs,
  reconcilePrefs,
  statusDotClass,
  writeBoardPrefs,
} from './board';

function status(over: Partial<ProjectStatus> & { id: string }): ProjectStatus {
  return {
    label: over.label ?? over.id,
    category: over.category ?? 'todo',
    color: over.color ?? 'st-todo',
    order: over.order ?? 0,
    ...(over.archived ? { archived: true } : {}),
    ...over,
  } as ProjectStatus;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    dump: () => Object.fromEntries(data),
  };
}

const NINE = [
  status({ id: 'backlog', label: 'Backlog', order: 0 }),
  status({ id: 'triage', label: 'Triage', order: 1 }),
  status({ id: 'ready', label: 'Ready', order: 2 }),
  status({ id: 'doing', label: 'Doing', category: 'in_progress', color: 'st-doing', order: 3 }),
  status({ id: 'review', label: 'Review', category: 'in_progress', color: 'st-review', order: 4 }),
  status({ id: 'qa', label: 'QA', category: 'in_progress', color: 'st-review', order: 5 }),
  status({ id: 'blocked', label: 'Blocked', category: 'in_progress', color: 'st-blocked', order: 6 }),
  status({ id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 7 }),
  status({ id: 'archive', label: 'Archive', category: 'done', color: 'st-archive', order: 8 }),
];

describe('board prefs storage', () => {
  it('keys prefs by project', () => {
    expect(boardPrefsKey('mcp')).toBe(`${BOARD_PREFS_PREFIX}mcp`);
    expect(boardPrefsKey('board-v04')).toBe(`${BOARD_PREFS_PREFIX}board-v04`);
  });

  it('reads empty prefs when storage is unavailable or empty', () => {
    expect(readBoardPrefs('mcp', null)).toEqual({ collapsed: [], hidden: [] });
    expect(readBoardPrefs('mcp', memoryStorage())).toEqual({ collapsed: [], hidden: [] });
  });

  it('round-trips collapsed and hidden columns', () => {
    const storage = memoryStorage();
    writeBoardPrefs('p1', { collapsed: ['review'], hidden: ['archive'] }, storage);
    expect(readBoardPrefs('p1', storage)).toEqual({ collapsed: ['review'], hidden: ['archive'] });
    expect(readBoardPrefs('p2', storage)).toEqual({ collapsed: [], hidden: [] });
  });

  it('sanitises junk values', () => {
    const storage = memoryStorage({ [boardPrefsKey('p')]: JSON.stringify({ collapsed: ['a', 'a', 3, ' ', null], hidden: 'nope' }) });
    expect(readBoardPrefs('p', storage)).toEqual({ collapsed: ['a'], hidden: [] });
    const notObject = memoryStorage({ [boardPrefsKey('p')]: '[1,2]' });
    expect(readBoardPrefs('p', notObject)).toEqual({ collapsed: [], hidden: [] });
    const broken = memoryStorage({ [boardPrefsKey('p')]: '{oops' });
    expect(readBoardPrefs('p', broken)).toEqual({ collapsed: [], hidden: [] });
  });

  it('survives storage that throws', () => {
    const throwingRead = { getItem: vi.fn(() => { throw new Error('denied'); }) };
    const throwingWrite = { setItem: vi.fn(() => { throw new Error('quota'); }) };
    expect(readBoardPrefs('p', throwingRead)).toEqual({ collapsed: [], hidden: [] });
    expect(() => writeBoardPrefs('p', { collapsed: ['a'], hidden: [] }, throwingWrite)).not.toThrow();
    expect(() => writeBoardPrefs('p', { collapsed: ['a'], hidden: [] }, null)).not.toThrow();
  });
});

describe('board columns', () => {
  it('orders by order, then label', () => {
    const unordered = [
      status({ id: 'b', label: 'Beta', order: 2 }),
      status({ id: 'a', label: 'Alpha', order: 1 }),
      status({ id: 'c', label: 'Alpha', order: 1 }),
    ];
    expect(orderStatuses(unordered).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps archived statuses off the board', () => {
    const withArchived = [...NINE, status({ id: 'old', label: 'Old', order: 9, archived: true })];
    expect(activeStatuses(withArchived).map((s) => s.id)).not.toContain('old');
  });

  it('splits visible, hidden and collapsed columns without reordering', () => {
    const prefs = { collapsed: ['review'], hidden: ['archive', 'qa'] };
    const columns = boardColumns(NINE, prefs);
    expect(columns.visible.map((s) => s.id)).toEqual(['backlog', 'triage', 'ready', 'doing', 'review', 'blocked', 'done']);
    expect(columns.hidden.map((s) => s.id)).toEqual(['qa', 'archive']);
    expect([...columns.collapsed]).toEqual(['review']);
  });

  it('drops prefs for statuses that no longer exist', () => {
    expect(reconcilePrefs(NINE, { collapsed: ['ghost', 'doing'], hidden: ['gone'] })).toEqual({
      collapsed: ['doing'],
      hidden: [],
    });
  });
});

describe('allowed transition targets', () => {
  it('offers every other status when the project has no graph', () => {
    expect(allowedTargets(null, 'doing', NINE)).toEqual([
      'backlog', 'triage', 'ready', 'review', 'qa', 'blocked', 'done', 'archive',
    ]);
    expect(allowedTargets(undefined, 'doing', NINE)).toHaveLength(8);
  });

  it('offers only the graph targets and never the current status', () => {
    const graph = { doing: ['review', 'blocked', 'review'] };
    expect(allowedTargets(graph, 'doing', NINE)).toEqual(['review', 'blocked']);
    expect(allowedTargets({ doing: ['doing'] }, 'doing', NINE)).toEqual([]);
  });

  it('mirrors the server fallback: a missing from-key means all statuses', () => {
    const graph = { review: ['done'] };
    expect(allowedTargets(graph, 'doing', NINE)).toHaveLength(8);
    expect(allowedTargets(graph, 'review', NINE)).toEqual(['done']);
  });

  it('ignores unknown and archived targets', () => {
    const withArchived = [...NINE, status({ id: 'old', label: 'Old', order: 9, archived: true })];
    expect(allowedTargets({ doing: ['ghost', 'done', 'old'] }, 'doing', withArchived)).toEqual(['done']);
    expect(isAllowedTarget({ doing: ['done'] }, 'doing', 'done', NINE)).toBe(true);
    expect(isAllowedTarget({ doing: ['done'] }, 'doing', 'qa', NINE)).toBe(false);
  });
});

describe('overflow cues', () => {
  const widths = Array(9).fill(COLUMN_WIDTH);

  it('offers only the right cue when the board starts at the left edge', () => {
    expect(overflowCues(0, 900, widths)).toEqual({ left: false, right: true, hiddenLeft: 0, hiddenRight: 5 });
  });

  it('offers both cues in the middle and neither at the end', () => {
    const total = widths.length * COLUMN_WIDTH + (widths.length - 1) * 12;
    const middle = overflowCues(400, 900, widths);
    expect(middle.left).toBe(true);
    expect(middle.right).toBe(true);
    expect(middle.hiddenLeft).toBe(1);
    const end = overflowCues(total - 900, 900, widths);
    expect(end.left).toBe(true);
    expect(end.right).toBe(false);
    expect(end.hiddenRight).toBe(0);
  });

  it('accounts for collapsed widths', () => {
    const mixed = [COLUMN_WIDTH, COLLAPSED_WIDTH, COLUMN_WIDTH, COLLAPSED_WIDTH];
    expect(overflowCues(0, COLUMN_WIDTH + 12 + COLLAPSED_WIDTH, mixed)).toEqual({
      left: false,
      right: true,
      hiddenLeft: 0,
      hiddenRight: 2,
    });
  });

  it('reports no overflow when every column fits', () => {
    expect(overflowCues(0, 2000, [COLUMN_WIDTH, COLUMN_WIDTH])).toEqual({
      left: false,
      right: false,
      hiddenLeft: 0,
      hiddenRight: 0,
    });
  });
});

describe('status colour tokens', () => {
  it('maps token names to token classes', () => {
    expect(statusDotClass({ color: 'st-review', category: 'in_progress' })).toBe('bg-st-review');
    expect(statusDotClass({ color: ' st-blocked ', category: 'in_progress' })).toBe('bg-st-blocked');
  });

  it('falls back to the category colour for unknown values', () => {
    expect(statusDotClass({ color: '#ff0000', category: 'done' })).toBe('bg-st-done');
    expect(statusDotClass({ color: '', category: 'in_progress' })).toBe('bg-st-doing');
    expect(statusDotClass({ color: 'neutral', category: 'todo' })).toBe('bg-st-todo');
  });
});
