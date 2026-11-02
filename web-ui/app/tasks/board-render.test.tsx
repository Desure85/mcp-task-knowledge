/**
 * web-ui/app/tasks/board-render.test.tsx — V-04 component contract.
 *
 * Server-rendered (no jsdom/RTL): the board components are hook-free on
 * purpose, so `renderToStaticMarkup` can assert the collapsed strip, the
 * denied-drop affordances and that the keyboard menu never offers a forbidden
 * status.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectStatus, Task } from '../../lib/api-client';
import { BoardColumn, type BoardColumnProps } from '../../components/board/BoardColumn';
import { MoveMenu } from '../../components/board/MoveMenu';

const backlog: ProjectStatus = {
  id: 'backlog',
  label: 'Backlog',
  category: 'todo',
  color: 'st-todo',
  order: 0,
};
const review: ProjectStatus = {
  id: 'review',
  label: 'In review',
  category: 'in_progress',
  color: 'st-review',
  order: 1,
};
const blocked: ProjectStatus = {
  id: 'blocked',
  label: 'Blocked',
  category: 'in_progress',
  color: 'st-blocked',
  order: 2,
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Card',
    status: 'backlog',
    priority: 'medium',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

function makeProps(overrides: Partial<BoardColumnProps> = {}): BoardColumnProps {
  return {
    status: backlog,
    tasks: [makeTask(), makeTask({ id: 't2', title: 'Second card' })],
    collapsed: false,
    dragActive: false,
    dropAllowed: false,
    dropDenied: false,
    hovered: false,
    draggingTaskId: null,
    droppable: true,
    allowedLabels: [],
    moveTargets: () => [],
    onCollapse: () => undefined,
    onExpand: () => undefined,
    onHide: () => undefined,
    onDragStart: () => undefined,
    onDragEnd: () => undefined,
    onDragEnter: () => undefined,
    onDragLeave: () => undefined,
    onDragOver: () => undefined,
    onDrop: () => undefined,
    onMove: () => undefined,
    onEdit: () => undefined,
    onClose: () => undefined,
    closeStatusId: 'archive',
    filtersActive: false,
    totalTasks: 2,
    ...overrides,
  };
}

describe('BoardColumn', () => {
  it('renders a collapsed strip with the vertical label, count and expand control', () => {
    const html = renderToStaticMarkup(<BoardColumn {...makeProps({ collapsed: true })} />);

    expect(html).toContain('w-12');
    expect(html).toContain('writing-mode:vertical-rl');
    expect(html).toContain('Backlog');
    expect(html).toContain('>2<');
    expect(html).toContain('aria-label="Expand Backlog"');
    expect(html).toContain('aria-expanded="false"');
    // The lane header (collapse/hide controls) is omitted on the strip.
    expect(html).not.toContain('aria-label="Hide Backlog"');
  });

  it('marks a forbidden drop target with the reason and allowed labels', () => {
    const html = renderToStaticMarkup(
      <BoardColumn
        {...makeProps({
          dragActive: true,
          dropDenied: true,
          hovered: true,
          allowedLabels: ['In review', 'Blocked'],
        })}
      />,
    );

    expect(html).toContain('data-drop="denied"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('Move to Backlog is not allowed');
    expect(html).toContain('Allowed: In review, Blocked');
  });

  it('marks an allowed drop target without the denied reason', () => {
    const html = renderToStaticMarkup(
      <BoardColumn {...makeProps({ dragActive: true, dropAllowed: true })} />,
    );

    expect(html).toContain('data-drop="allowed"');
    expect(html).not.toContain('data-drop="denied"');
    expect(html).not.toContain('is not allowed');
  });
});

describe('MoveMenu', () => {
  it('renders only the allowed target labels', () => {
    const html = renderToStaticMarkup(
      <MoveMenu taskTitle="Card" targets={[review, blocked]} onMove={() => undefined} />,
    );

    expect(html).toContain('Move to…');
    expect(html).toContain('In review');
    expect(html).toContain('Blocked');
    expect(html).not.toContain('Backlog');
  });

  it('renders no menu when there are no allowed targets', () => {
    const html = renderToStaticMarkup(
      <MoveMenu taskTitle="Card" targets={[]} onMove={() => undefined} />,
    );

    expect(html).toBe('');
  });
});
