/**
 * web-ui/lib/project-settings.test.ts — UI-35 pure draft logic.
 *
 * The screen's correctness rests on this module: reordering, "is the draft
 * dirty", the client-side validation hints, and the client mirror of the
 * server's transition-reachability rule. The server stays the authority; these
 * tests pin the mirror so the UI warns *before* a doomed request is sent.
 */

import { describe, expect, it } from 'vitest';
import type { ProjectStatus, ProjectType } from './api-client';
import {
  ID_RE,
  canonicalTransitions,
  defaultInitialStatuses,
  describeToolError,
  fullMatrix,
  idFromLabel,
  isTransitionAllowed,
  materializeTransitions,
  moveStatus,
  moveStatusTo,
  moveTargetsFor,
  moveType,
  parseInUseError,
  removedIds,
  restoreMissingStatuses,
  restoreMissingTypes,
  statusesDirty,
  statusesDraftFrom,
  statusesPayload,
  statusesReferencedByTransitions,
  toggleTransition,
  transitionConflictMessage,
  transitionsDraftFrom,
  transitionsDirty,
  typesDirty,
  typesDraftFrom,
  typesPayload,
  unreachableDoneMessage,
  unreachableDoneStatuses,
  updateStatus,
  validateStatusDraft,
  validateTypesDraft,
  withoutStatuses,
  withoutTypes,
} from './project-settings';

const statuses: ProjectStatus[] = [
  { id: 'pending', label: 'Pending', category: 'todo', color: 'st-todo', order: 0 },
  { id: 'in_progress', label: 'In progress', category: 'in_progress', color: 'st-doing', order: 1 },
  { id: 'completed', label: 'Completed', category: 'done', color: 'st-done', order: 2 },
  { id: 'closed', label: 'Closed', category: 'done', color: 'st-archive', order: 3 },
];

const types: ProjectType[] = [
  { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
  { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
  { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
];

function draftFrom(source: ProjectStatus[] = statuses) {
  return statusesDraftFrom({
    statuses: source,
    closeStatus: 'closed',
    initialStatuses: ['pending'],
  });
}

describe('UI-35 statuses draft', () => {
  it('copies the server view and renumbers order', () => {
    const draft = statusesDraftFrom({
      statuses: [
        { id: 'b', label: 'B', category: 'todo', color: 'st-todo', order: 7 },
        { id: 'a', label: 'A', category: 'done', color: 'st-done', order: 3 },
      ],
      closeStatus: 'a',
      initialStatuses: ['b'],
    });
    expect(draft.statuses.map((status) => [status.id, status.order])).toEqual([
      ['b', 0],
      ['a', 1],
    ]);
    expect(draft.closeStatus).toBe('a');
    expect(draft.initialStatuses).toEqual(['b']);
  });

  it('falls back to the first done status and the todo statuses', () => {
    const draft = statusesDraftFrom({
      statuses: statuses.map((status) => ({ ...status, archived: status.id === 'closed' })),
      closeStatus: 'closed',
      initialStatuses: [],
    });
    expect(draft.closeStatus).toBe('completed');
    expect(draft.initialStatuses).toEqual(['pending']);
  });

  it('moves a row up and down and renumbers', () => {
    const draft = draftFrom();
    const moved = moveStatus(draft.statuses, 2, -1);
    expect(moved.map((status) => status.id)).toEqual(['pending', 'completed', 'in_progress', 'closed']);
    expect(moved.map((status) => status.order)).toEqual([0, 1, 2, 3]);
  });

  it('treats an edge move as a no-op', () => {
    const draft = draftFrom();
    expect(moveStatus(draft.statuses, 0, -1).map((status) => status.id)).toEqual(
      draft.statuses.map((status) => status.id),
    );
    expect(moveStatus(draft.statuses, 3, 1).map((status) => status.id)).toEqual(
      draft.statuses.map((status) => status.id),
    );
  });

  it('supports drag & drop between arbitrary positions', () => {
    const draft = draftFrom();
    expect(moveStatusTo(draft.statuses, 0, 3).map((status) => status.id)).toEqual([
      'in_progress',
      'completed',
      'closed',
      'pending',
    ]);
  });

  it('edits a status without touching the others', () => {
    const draft = draftFrom();
    const edited = updateStatus(draft.statuses, 'in_progress', { label: 'Doing', category: 'done' });
    expect(edited[1]).toMatchObject({ id: 'in_progress', label: 'Doing', category: 'done' });
    expect(edited[0]).toMatchObject({ id: 'pending', label: 'Pending', category: 'todo' });
  });

  it('detects unsaved changes by content, order and references', () => {
    const draft = draftFrom();
    expect(statusesDirty(draft, draftFrom())).toBe(false);
    expect(statusesDirty({ ...draft, closeStatus: 'completed' }, draft)).toBe(true);
    expect(statusesDirty({ ...draft, initialStatuses: ['pending', 'in_progress'] }, draft)).toBe(true);
    expect(statusesDirty({ ...draft, statuses: moveStatus(draft.statuses, 0, 1) }, draft)).toBe(true);
  });

  it('ignores surrounding whitespace when comparing labels', () => {
    const draft = draftFrom();
    const baselineWithLabel = {
      ...draft,
      statuses: updateStatus(draft.statuses, 'pending', { label: 'Backlog' }),
    };
    const padded = { ...draft, statuses: updateStatus(draft.statuses, 'pending', { label: '  Backlog ' }) };
    expect(statusesDirty(padded, baselineWithLabel)).toBe(false);
  });

  it('rejects an empty label, bad id, duplicate id and a missing done/todo status', () => {
    const draft = draftFrom();
    expect(validateStatusDraft({ ...draft, statuses: updateStatus(draft.statuses, 'pending', { label: '  ' }) }))
      .toContain('Status "pending" needs a name.');
    expect(validateStatusDraft({ ...draft, statuses: updateStatus(draft.statuses, 'pending', { id: '1bad' }) }))
      .toContain('Status id "1bad" must start with a letter and use lowercase letters, digits, "-" or "_".');
    const duplicated = [...draft.statuses, { ...draft.statuses[0] }];
    expect(validateStatusDraft({ ...draft, statuses: duplicated })).toContain('Duplicate status id "pending".');
    const noTodo = draft.statuses.filter((status) => status.category !== 'todo');
    expect(validateStatusDraft({ ...draft, statuses: noTodo })).toContain(
      'At least one active status must have the "To do" category.',
    );
    const noDone = draft.statuses.filter((status) => status.category !== 'done');
    expect(validateStatusDraft({ ...draft, statuses: noDone })).toContain(
      'At least one active status must have the "Done" category.',
    );
  });

  it('requires a done close status and known initial statuses', () => {
    const draft = draftFrom();
    expect(validateStatusDraft({ ...draft, closeStatus: 'pending' })).toContain(
      'The close status must be an active "Done" status.',
    );
    expect(validateStatusDraft({ ...draft, closeStatus: '' })).toContain(
      'Choose the status used when a task is closed.',
    );
    expect(validateStatusDraft({ ...draft, initialStatuses: [] })).toContain(
      'Choose at least one status for new tasks.',
    );
    expect(validateStatusDraft({ ...draft, initialStatuses: ['ghost'] })).toContain(
      'Initial status "ghost" is not in the status set.',
    );
    expect(validateStatusDraft(draft)).toEqual([]);
  });

  it('drops references to deleted statuses and keeps the draft valid', () => {
    const draft = draftFrom();
    const next = withoutStatuses(draft, ['closed', 'pending']);
    expect(next.statuses.map((status) => status.id)).toEqual(['in_progress', 'completed']);
    expect(next.closeStatus).toBe('completed');
    expect(next.initialStatuses).toEqual([]);
    expect(validateStatusDraft(next)).toContain('Choose at least one status for new tasks.');
  });

  it('serialises the payload the server expects', () => {
    const draft = statusesDraftFrom({
      statuses: [
        { id: 'todo', label: ' Todo ', category: 'todo', color: 'st-todo', order: 5 },
        { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 2, archived: true },
      ],
      closeStatus: 'done',
      initialStatuses: ['todo'],
    });
    expect(statusesPayload(draft)).toEqual([
      { id: 'todo', label: 'Todo', category: 'todo', color: 'st-todo', order: 0 },
      { id: 'done', label: 'Done', category: 'done', color: 'st-done', order: 1, archived: true },
    ]);
  });

  it('reports ids that the draft removed', () => {
    const draft = draftFrom();
    expect(removedIds(statuses, withoutStatuses(draft, ['closed']).statuses)).toEqual(['closed']);
    expect(removedIds(statuses, draft.statuses)).toEqual([]);
  });

  it('restores a refused deletion without losing other edits', () => {
    const draft = withoutStatuses(draftFrom(), ['closed']);
    const edited = { ...draft, statuses: updateStatus(draft.statuses, 'pending', { label: 'Backlog' }) };
    const restored = restoreMissingStatuses(edited, draftFrom());
    expect(restored.statuses.map((status) => status.id)).toEqual([
      'pending',
      'in_progress',
      'completed',
      'closed',
    ]);
    expect(restored.statuses[0].label).toBe('Backlog');
    expect(restored.closeStatus).toBe('closed');
  });
});

describe('UI-35 id and type helpers', () => {
  it('builds a slug from a label, ASCII only', () => {
    expect(idFromLabel('Code Review', [])).toBe('code_review');
    expect(idFromLabel('  Идея  ', [], 'status')).toBe('status');
    expect(idFromLabel('123', [], 'status')).toBe('status_123');
    expect(ID_RE.test(idFromLabel('A'.repeat(60), []))).toBe(true);
  });

  it('keeps generated ids unique', () => {
    expect(idFromLabel('Review', ['review'])).toBe('review_2');
    expect(idFromLabel('Review', ['review', 'review_2'])).toBe('review_3');
  });

  it('reorders types and reports dirty sets', () => {
    const draft = typesDraftFrom({ types });
    expect(moveType(draft.types, 0, 1).map((type) => type.id)).toEqual(['bug', 'task', 'feature']);
    expect(typesDirty(draft, typesDraftFrom({ types }))).toBe(false);
    expect(typesDirty({ types: moveType(draft.types, 0, 1) }, draft)).toBe(true);
    expect(typesDirty({ types: draft.types.map((type) => ({ ...type, color: 'ty-bug' })) }, draft)).toBe(true);
  });

  it('validates type ids and labels', () => {
    expect(validateTypesDraft(typesDraftFrom({ types }))).toEqual([]);
    expect(validateTypesDraft({ types: [] })).toContain('Add at least one task type.');
    expect(validateTypesDraft({ types: [{ id: 'Bad', label: 'x' }] })).toContain(
      'Type id "Bad" must start with a letter and use lowercase letters, digits, "-" or "_".',
    );
    expect(validateTypesDraft({ types: [{ id: 'a', label: ' ' }] })).toContain('Type "a" needs a name.');
  });

  it('serialises types and restores refused deletions', () => {
    expect(typesPayload({ types: [{ id: 'bug', label: ' Bug ', color: 'ty-bug', icon: 'bug' }] })).toEqual([
      { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
    ]);
    const removed = withoutTypes({ types }, ['bug']);
    expect(removed.types.map((type) => type.id)).toEqual(['task', 'feature']);
    expect(restoreMissingTypes(removed, { types }).types.map((type) => type.id)).toEqual([
      'task',
      'bug',
      'feature',
    ]);
  });
});

describe('UI-35 transition matrix', () => {
  const all = fullMatrix(statuses);

  it('builds an any-to-any matrix over active statuses only', () => {
    const withArchived = [...statuses, { ...statuses[0], id: 'old', archived: true }];
    expect(fullMatrix(withArchived)).toEqual({
      pending: ['pending', 'in_progress', 'completed', 'closed'],
      in_progress: ['pending', 'in_progress', 'completed', 'closed'],
      completed: ['pending', 'in_progress', 'completed', 'closed'],
      closed: ['pending', 'in_progress', 'completed', 'closed'],
    });
  });

  it('reads an unrestricted draft as any-to-any', () => {
    expect(isTransitionAllowed(null, 'pending', 'closed')).toBe(true);
    expect(isTransitionAllowed(null, 'pending', 'pending')).toBe(false);
  });

  it('treats a missing source key as unrestricted, like the server', () => {
    expect(isTransitionAllowed({ completed: [] }, 'pending', 'completed')).toBe(true);
    expect(isTransitionAllowed({ completed: [] }, 'completed', 'closed')).toBe(false);
  });

  it('toggles one cell and materialises the graph first', () => {
    const draft = transitionsDraftFrom({ transitions: null, unrestricted: true });
    const once = toggleTransition(draft, statuses, 'pending', 'closed');
    expect(isTransitionAllowed(once.transitions, 'pending', 'closed')).toBe(false);
    expect(isTransitionAllowed(once.transitions, 'pending', 'in_progress')).toBe(true);
    const twice = toggleTransition(once, statuses, 'pending', 'closed');
    expect(isTransitionAllowed(twice.transitions, 'pending', 'closed')).toBe(true);
  });

  it('refuses to toggle the diagonal', () => {
    const draft = transitionsDraftFrom({ transitions: null, unrestricted: true });
    expect(toggleTransition(draft, statuses, 'pending', 'pending')).toBe(draft);
  });

  it('keeps an explicit any-to-any matrix distinct from the null graph', () => {
    const explicit = transitionsDraftFrom({ transitions: all, unrestricted: false });
    const unrestricted = transitionsDraftFrom({ transitions: null, unrestricted: true });
    expect(transitionsDirty(explicit, unrestricted)).toBe(true);
    expect(transitionsDirty(explicit, transitionsDraftFrom({ transitions: all, unrestricted: false }))).toBe(false);
  });

  it('reports done statuses unreachable from the initial statuses', () => {
    const restricted = { pending: ['in_progress'], in_progress: [], completed: [], closed: [] };
    expect(unreachableDoneStatuses(statuses, ['pending'], restricted)).toEqual(['completed', 'closed']);
    expect(unreachableDoneStatuses(statuses, ['pending'], { ...restricted, in_progress: ['closed'] })).toEqual([
      'completed',
    ]);
    expect(unreachableDoneStatuses(statuses, ['pending'], null)).toEqual([]);
  });

  it('leaves a reached status unrestricted when its key is missing', () => {
    expect(unreachableDoneStatuses(statuses, ['pending'], { pending: ['in_progress'] })).toEqual([]);
    expect(unreachableDoneStatuses(statuses, ['pending'], { pending: ['in_progress'], in_progress: [] })).toEqual([
      'completed',
      'closed',
    ]);
  });

  it('explains which done status is unreachable, by label', () => {
    const message = unreachableDoneMessage(statuses, ['closed'], ['pending']);
    expect(message).toContain('Done status Closed');
    expect(message).toContain('Pending');
  });

  it('materialises every active source and drops self-transitions', () => {
    const withArchived = [...statuses, { ...statuses[0], id: 'old', archived: true }];
    const graph = materializeTransitions(
      { transitions: { pending: ['pending', 'in_progress'], ghost: ['pending'], old: ['pending'] } },
      withArchived,
    );
    expect(graph?.pending).toEqual(['in_progress']);
    expect(graph?.completed).toEqual([]);
    expect(graph?.ghost).toBeUndefined();
    expect(graph?.old).toEqual(['pending']);
  });

  it('keeps an explicit graph distinct from any-to-any when comparing', () => {
    expect(canonicalTransitions(null)).toBe('any');
    expect(canonicalTransitions({})).toBe('');
    expect(transitionsDirty({ transitions: null }, { transitions: null })).toBe(false);
    expect(transitionsDirty({ transitions: {} }, { transitions: null })).toBe(true);
  });
});


describe('UI-35 server error helpers', () => {
  it('reads the blocked removals out of a STATUS_IN_USE reply', () => {
    const blocked = parseInUseError(
      {
        statuses: [{ status: 'review', taskIds: ['t1', 't2'], total: 42 }],
        taskIds: ['t1'],
        total: 42,
      },
      'status',
    );
    expect(blocked).toEqual([{ id: 'review', total: 42, taskIds: ['t1', 't2'] }]);
  });

  it('reads the blocked removals out of a TYPE_IN_USE reply', () => {
    expect(parseInUseError({ types: [{ type: 'chore', taskIds: [], total: 1 }] }, 'type')).toEqual([
      { id: 'chore', total: 1, taskIds: [] },
    ]);
  });

  it('degrades to an empty list for an unexpected shape', () => {
    expect(parseInUseError(null, 'status')).toEqual([]);
    expect(parseInUseError({ statuses: 'nope' }, 'status')).toEqual([]);
    expect(parseInUseError({ statuses: [{ taskIds: ['t'] }] }, 'status')).toEqual([]);
  });

  it('formats a tool error with its code and hint', () => {
    expect(describeToolError({ message: 'status is used', code: 'STATUS_IN_USE', hint: "pass moveTo='x'" })).toBe(
      "status is used (STATUS_IN_USE) — pass moveTo='x'",
    );
    expect(describeToolError(new Error('network'))).toBe('network');
    expect(describeToolError(null)).toBe('Request failed');
  });

  it('builds per-status moves for the retry', () => {
    expect(moveTargetsFor(['a', 'b'], 'c')).toEqual({ a: 'c', b: 'c' });
  });

  it('names removed statuses that the saved graph still references', () => {
    const draft = withoutStatuses(draftFrom(), ['closed']);
    const referenced = statusesReferencedByTransitions(statuses, draft.statuses, {
      pending: ['in_progress'],
      completed: ['closed'],
    });
    expect(referenced).toEqual(['closed']);
    expect(transitionConflictMessage(statuses, referenced)).toContain('Closed');
    expect(statusesReferencedByTransitions(statuses, statuses, { pending: ['closed'] })).toEqual([]);
    expect(statusesReferencedByTransitions(statuses, draft.statuses, null)).toEqual([]);
  });

  it('reports a removed status that only appears as a graph source', () => {
    const draft = withoutStatuses(draftFrom(), ['completed']);
    expect(statusesReferencedByTransitions(statuses, draft.statuses, { completed: ['closed'] })).toEqual([
      'completed',
    ]);
  });

  it('defaults initial statuses to active todos', () => {
    expect(defaultInitialStatuses([...statuses, { ...statuses[0], id: 'later', archived: true }])).toEqual([
      'pending',
    ]);
  });
});
