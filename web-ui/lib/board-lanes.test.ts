import { describe, it, expect, vi } from 'vitest';
import type { ProjectType, Task } from './api-client';
import {
  DEFAULT_TASK_TYPE,
  LANES_PREFS_PREFIX,
  OTHER_LANE_ID,
  buildLanes,
  defaultCollapsedLanes,
  lanesPrefsKey,
  readLanePrefs,
  reconcileSelectedTypes,
  resolveSelectedTypes,
  taskTypeId,
  typeDotClass,
  writeLanePrefs,
} from './board-lanes';

const TYPES: ProjectType[] = [
  { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
  { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
  { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
];

let seq = 0;
function task(over: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    status: 'backlog',
    priority: 'medium',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...over,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('lane type resolution', () => {
  it('treats a missing or blank type as task', () => {
    expect(taskTypeId({ type: undefined })).toBe(DEFAULT_TASK_TYPE);
    expect(taskTypeId({ type: '   ' })).toBe(DEFAULT_TASK_TYPE);
    expect(taskTypeId({ type: ' bug ' })).toBe('bug');
    expect(taskTypeId({ type: 'custom' })).toBe('custom');
  });

  it('resolves an empty selection to every type in project order', () => {
    expect(resolveSelectedTypes(TYPES, [])).toEqual(['task', 'bug', 'feature']);
  });

  it('keeps project order for an explicit selection and drops unknown ids', () => {
    expect(resolveSelectedTypes(TYPES, ['feature', 'ghost', 'task'])).toEqual(['task', 'feature']);
    expect(reconcileSelectedTypes(TYPES, ['ghost', 'bug'])).toEqual(['bug']);
  });

  it('falls back to all types when the stored selection no longer matches', () => {
    expect(resolveSelectedTypes(TYPES, ['ghost'])).toEqual(['task', 'bug', 'feature']);
  });
});

describe('buildLanes', () => {
  const tasks = [
    task({ title: 'plain' }),
    task({ title: 'bug one', type: 'bug' }),
    task({ title: 'feature one', type: 'feature' }),
    task({ title: 'bug two', type: 'bug' }),
    task({ title: 'legacy', type: 'weird' }),
  ];

  it('splits by type in project order with counts and keeps task order', () => {
    const lanes = buildLanes(TYPES, tasks);
    expect(lanes.map((lane) => lane.id)).toEqual(['task', 'bug', 'feature', OTHER_LANE_ID]);
    expect(lanes[1].tasks.map((item) => item.title)).toEqual(['bug one', 'bug two']);
    expect(lanes[1].label).toBe('Bug');
    expect(lanes[1].color).toBe('ty-bug');
    expect(lanes[1].known).toBe(true);
    expect(lanes[3].known).toBe(false);
  });

  it('puts tasks with an unknown type into one Other lane', () => {
    const lanes = buildLanes(TYPES, [
      task({ title: 'a', type: 'weird' }),
      task({ title: 'b', type: 'stranger' }),
    ]);
    const other = lanes.find((lane) => lane.id === OTHER_LANE_ID);
    expect(other?.tasks.map((item) => item.title)).toEqual(['a', 'b']);
    expect(other?.label).toBe('Other');
  });

  it('does not show Other when a subset of types is selected', () => {
    const lanes = buildLanes(TYPES, tasks, { selected: ['bug'] });
    expect(lanes.map((lane) => lane.id)).toEqual(['bug']);
    expect(lanes[0].tasks.map((item) => item.title)).toEqual(['bug one', 'bug two']);
  });

  it('returns a single lane for a single selected type', () => {
    expect(buildLanes(TYPES, tasks, { selected: ['feature'] })).toHaveLength(1);
  });

  it('hides empty lanes by default and shows them on request', () => {
    const onlyBugs = [task({ title: 'bug', type: 'bug' })];
    expect(buildLanes(TYPES, onlyBugs).map((lane) => lane.id)).toEqual(['bug']);
    expect(buildLanes(TYPES, onlyBugs, { showEmpty: true }).map((lane) => lane.id)).toEqual([
      'task', 'bug', 'feature',
    ]);
  });

  it('never fabricates an Other lane without unknown tasks', () => {
    expect(buildLanes(TYPES, [task({ title: 'plain' })]).map((lane) => lane.id)).toEqual(['task']);
  });

  it('returns no lanes when everything is filtered or hidden', () => {
    expect(buildLanes(TYPES, [], { selected: ['bug'] })).toEqual([]);
  });
});

describe('lane prefs', () => {
  it('keys prefs by project', () => {
    expect(lanesPrefsKey('mcp')).toBe(`${LANES_PREFS_PREFIX}mcp`);
  });

  it('returns defaults without storage or with the key missing', () => {
    const expected = { selectedTypes: [], collapsedLanes: [], showEmptyLanes: false };
    expect(readLanePrefs('p', null)).toEqual({ prefs: expected, stored: false });
    expect(readLanePrefs('p', memoryStorage())).toEqual({ prefs: expected, stored: false });
  });

  it('round-trips selection, collapsed lanes and the empty-lane flag', () => {
    const storage = memoryStorage();
    writeLanePrefs('p', { selectedTypes: ['bug', 'feature'], collapsedLanes: ['feature'], showEmptyLanes: true }, storage);
    expect(readLanePrefs('p', storage)).toEqual({
      prefs: { selectedTypes: ['bug', 'feature'], collapsedLanes: ['feature'], showEmptyLanes: true },
      stored: true,
    });
  });

  it('sanitises junk and survives broken storage', () => {
    const junk = memoryStorage({
      [lanesPrefsKey('p')]: JSON.stringify({ selectedTypes: ['a', 'a', 2, ''], collapsedLanes: 'no', showEmptyLanes: 'yes' }),
    });
    expect(readLanePrefs('p', junk).prefs).toEqual({ selectedTypes: ['a'], collapsedLanes: [], showEmptyLanes: false });
    const broken = memoryStorage({ [lanesPrefsKey('p')]: '{nope' });
    expect(readLanePrefs('p', broken)).toEqual({
      prefs: { selectedTypes: [], collapsedLanes: [], showEmptyLanes: false },
      stored: false,
    });
    const throwingRead = { getItem: vi.fn(() => { throw new Error('denied'); }) };
    const throwingWrite = { setItem: vi.fn(() => { throw new Error('quota'); }) };
    expect(readLanePrefs('p', throwingRead).stored).toBe(false);
    expect(() => writeLanePrefs('p', { selectedTypes: ['a'], collapsedLanes: [], showEmptyLanes: false }, throwingWrite)).not.toThrow();
    expect(() => writeLanePrefs('p', { selectedTypes: [], collapsedLanes: [], showEmptyLanes: false }, null)).not.toThrow();
  });

  it('maps type colours to token classes with a task fallback', () => {
    expect(typeDotClass({ color: 'ty-bug' })).toBe('bg-ty-bug');
    expect(typeDotClass({ color: ' ty-feature ' })).toBe('bg-ty-feature');
    expect(typeDotClass({ color: '#ff0000' })).toBe('bg-ty-task');
    expect(typeDotClass(undefined)).toBe('bg-ty-task');
  });

  it('starts every lane collapsed on mobile', () => {
    const lanes = buildLanes(TYPES, [task({ title: 'a' }), task({ title: 'b', type: 'bug' })]);
    expect(defaultCollapsedLanes(lanes)).toEqual(['task', 'bug']);
  });
});
