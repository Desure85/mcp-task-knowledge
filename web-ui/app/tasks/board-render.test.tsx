/**
 * web-ui/app/tasks/board-render.test.tsx — V-04/V-05 component contract.
 *
 * Server-rendered (no jsdom/RTL): every board component is hook-free on
 * purpose, so `renderToStaticMarkup` can assert the lane band, the folded lane
 * (band without cards), the type badge and the type multi-select checked state,
 * plus the keyboard menu never offering a forbidden status.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectStatus, ProjectType, Task } from '../../lib/api-client';
import { LaneSection, type LaneSectionProps } from '../../components/board/LaneSection';
import { StatusCell, type StatusCellProps } from '../../components/board/StatusCell';
import { MoveMenu } from '../../components/board/MoveMenu';
import { TypeBadge } from '../../components/board/TypeBadge';
import { TypeMultiSelect } from '../../components/board/TypeMultiSelect';

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

const TYPES: ProjectType[] = [
  { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' },
  { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' },
  { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' },
  { id: 'chore', label: 'Chore', color: 'ty-chore', icon: 'chore' },
];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Card',
    status: 'backlog',
    priority: 'medium',
    type: 'bug',
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

function makeLaneProps(overrides: Partial<LaneSectionProps> = {}): LaneSectionProps {
  return {
    laneId: 'bug',
    label: 'Bug',
    count: 3,
    collapsed: false,
    type: TYPES[1],
    headerStyle: { gridColumn: '1 / -1', gridRow: 2 },
    showHeader: true,
    columns: [backlog, review],
    renderCell: (status) => (
      <article key={status.id} data-task="t1">
        Card
      </article>
    ),
    onToggle: () => undefined,
    ...overrides,
  };
}

function makeCellProps(overrides: Partial<StatusCellProps> = {}): StatusCellProps {
  return {
    laneId: 'bug',
    laneLabel: 'Bug',
    status: backlog,
    tasks: [makeTask()],
    dragActive: false,
    dropAllowed: false,
    dropDenied: false,
    denyReason: null,
    hovered: false,
    draggingTaskId: null,
    droppable: true,
    allowedLabels: [],
    types: TYPES,
    moveTargets: () => [],
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
    totalTasks: 1,
    ...overrides,
  };
}

function checkedInputs(html: string): string[] {
  return html
    .match(/<input[^>]*>/g)
    ?.filter((tag) => tag.includes('checked=""')) ?? [];
}

describe('LaneSection', () => {
  it('renders the lane band with label, count and an expanded collapse control', () => {
    const html = renderToStaticMarkup(<LaneSection {...makeLaneProps()} />);

    expect(html).toContain('data-lane="bug"');
    expect(html).toContain('>Bug<');
    expect(html).toContain('>3<');
    expect(html).toContain('aria-label="Collapse Bug lane"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-task="t1"');
  });

  it('keeps the band but drops every card when the lane is collapsed', () => {
    const html = renderToStaticMarkup(<LaneSection {...makeLaneProps({ collapsed: true })} />);

    expect(html).toContain('data-lane="bug"');
    expect(html).toContain('>Bug<');
    expect(html).toContain('aria-label="Expand Bug lane"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-task="t1"');
  });

  it('omits the band in single-board mode but still renders the cells', () => {
    const html = renderToStaticMarkup(
      <LaneSection {...makeLaneProps({ showHeader: false })} />,
    );

    expect(html).not.toContain('data-slot="lane-header"');
    expect(html).toContain('data-task="t1"');
  });
});

describe('StatusCell', () => {
  it('marks a forbidden status with the reason and allowed labels', () => {
    const html = renderToStaticMarkup(
      <StatusCell
        {...makeCellProps({
          dragActive: true,
          dropDenied: true,
          denyReason: 'status',
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

  it('marks an allowed status without the denied reason', () => {
    const html = renderToStaticMarkup(
      <StatusCell {...makeCellProps({ dragActive: true, dropAllowed: true })} />,
    );

    expect(html).toContain('data-drop="allowed"');
    expect(html).not.toContain('data-drop="denied"');
    expect(html).not.toContain('is not allowed');
  });

  it('refuses a cross-lane drop by pointing at the card form', () => {
    const html = renderToStaticMarkup(
      <StatusCell
        {...makeCellProps({
          dragActive: true,
          dropDenied: true,
          denyReason: 'type',
          hovered: true,
        })}
      />,
    );

    expect(html).toContain('Change the type in the card form');
    expect(html).not.toContain('Move to Backlog is not allowed');
  });

  it('renders the card type badge inside the cell', () => {
    const html = renderToStaticMarkup(<StatusCell {...makeCellProps()} />);

    expect(html).toContain('data-type="bug"');
    expect(html).toContain('Type: Bug');
  });
});

describe('TypeBadge', () => {
  it('shows the type label and its token dot', () => {
    const html = renderToStaticMarkup(<TypeBadge type={TYPES[1]} />);

    expect(html).toContain('data-type="bug"');
    expect(html).toContain('>Bug<');
    expect(html).toContain('bg-ty-bug');
    expect(html).toContain('title="Type: Bug"');
  });

  it('falls back to the task tone for a type without a token colour', () => {
    const html = renderToStaticMarkup(<TypeBadge type={TYPES[3]} />);

    expect(html).toContain('bg-ty-task');
    expect(html).toContain('>Chore<');
  });
});

describe('TypeMultiSelect', () => {
  it('checks every type and summarises the selection as all', () => {
    const html = renderToStaticMarkup(
      <TypeMultiSelect
        types={TYPES}
        selected={[]}
        resolved={TYPES.map((type) => type.id)}
        showEmptyLanes={false}
        onToggleType={() => undefined}
        onSelectAll={() => undefined}
        onToggleShowEmpty={() => undefined}
      />,
    );

    expect(html).toContain('Types: All');
    expect(html).toContain('Types · 4');
    expect(checkedInputs(html)).toHaveLength(4);
    expect(html).toContain('All types');
    expect(html).toContain('Show empty lanes');
  });

  it('checks only the selected types and names a single one', () => {
    const html = renderToStaticMarkup(
      <TypeMultiSelect
        types={TYPES}
        selected={['bug']}
        resolved={['bug']}
        showEmptyLanes
        onToggleType={() => undefined}
        onSelectAll={() => undefined}
        onToggleShowEmpty={() => undefined}
      />,
    );

    expect(html).toContain('Types: Bug');
    expect(html).toContain('Types · 1');
    const checked = checkedInputs(html);
    expect(checked).toHaveLength(2);
    expect(checked.some((tag) => tag.includes('data-type="bug"'))).toBe(true);
    expect(checked.some((tag) => tag.includes('data-type="task"'))).toBe(false);
    expect(checked.some((tag) => tag.includes('name="board-show-empty-lanes"'))).toBe(true);
  });

  it('summarises a partial selection as a ratio', () => {
    const html = renderToStaticMarkup(
      <TypeMultiSelect
        types={TYPES}
        selected={['bug', 'feature']}
        resolved={['bug', 'feature']}
        showEmptyLanes={false}
        onToggleType={() => undefined}
        onSelectAll={() => undefined}
        onToggleShowEmpty={() => undefined}
      />,
    );

    expect(html).toContain('Types: 2 of 4');
    expect(html).toContain('Types · 2');
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
