/**
 * web-ui/components/settings/types-tab.test.tsx — UI-35 task type editor.
 *
 * Server-rendered contract: the tab is hook-free on purpose, so
 * `renderToStaticMarkup` asserts the rows, the order buttons' disabled edges,
 * the colour/icon selects with their selected values, the glyph preview, the
 * issue alert, the per-row delete labels, the add action and the drag handle.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectType } from '@/lib/api-client';
import type { TypesDraft } from '@/lib/project-settings';
import { TypesTab, type TypesTabProps } from './TypesTab';

/** Deliberately ordered task, bug, feature so the edges and the middle differ. */
const TASK: ProjectType = { id: 'task', label: 'Task', color: 'ty-task', icon: 'task' };
const BUG: ProjectType = { id: 'bug', label: 'Bug', color: 'ty-bug', icon: 'bug' };
const FEATURE: ProjectType = { id: 'feature', label: 'Feature', color: 'ty-feature', icon: 'feature' };

function makeDraft(overrides: Partial<TypesDraft> = {}): TypesDraft {
  return { types: [TASK, BUG, FEATURE], ...overrides };
}

function makeProps(overrides: Partial<TypesTabProps> = {}): TypesTabProps {
  const draft = makeDraft();
  return {
    draft,
    baseline: makeDraft(),
    issues: [],
    disabled: false,
    onChange: () => undefined,
    ...overrides,
  };
}

/** The whole tag containing `marker`, without spelling a native tag in this file. */
function tagAround(html: string, marker: string): string {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf('>', at);
  return html.slice(start, end + 1);
}

function selectedOptionValues(html: string): string[] {
  const tags = html.match(/option[^>]*selected=""[^>]*>/g) ?? [];
  return tags.map((tag) => tag.match(/value="([^"]*)"/)?.[1] ?? '');
}

describe('TypesTab', () => {
  it('renders one row per type with its id and current name', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html).toContain('data-type="task"');
    expect(html).toContain('data-type="bug"');
    expect(html).toContain('data-type="feature"');
    expect(html).toContain('value="Task"');
    expect(html).toContain('value="Bug"');
    expect(html).toContain('value="Feature"');
    expect(html).toContain('Name for task');
    expect(html).toContain('Name for feature');
  });

  it('makes every row draggable', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html.match(/draggable="true"/g)).toHaveLength(3);
  });

  it('disables the first up arrow and the last down arrow, keeps the middle enabled', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(tagAround(html, 'aria-label="Move Task up"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Feature down"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Bug up"')).not.toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Feature up"')).not.toContain('disabled=""');
  });

  it('offers every colour token, selects the type token and shows its dot', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html).toContain('Colour for bug');
    expect(html).toContain('aria-label="Neutral (ty-task)"');
    expect(html).toContain('aria-label="Danger (ty-bug)"');
    expect(html).toContain('aria-label="Secondary (ty-feature)"');
    expect(html).toContain('aria-label="Slate (st-slate)"');
    expect(html).toContain('color-token-preview-light');
    expect(html).toContain('color-token-preview-dark');
    expect(html).toContain('bg-ty-bug');
    expect(html).toContain('aria-checked="true"');
  });

  it('selects the current icon and renders the matching glyph preview', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html).toContain('Icon for bug');
    expect(selectedOptionValues(html)).toContain('bug');
    expect(selectedOptionValues(html)).toContain('feature');
    expect(html.match(/<svg/g)).toHaveLength(3);
    expect(html).toContain('viewBox="0 0 24 24"');
  });

  it('gives every delete button its own label', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html).toContain('aria-label="Delete Task"');
    expect(html).toContain('aria-label="Delete Bug"');
    expect(html).toContain('aria-label="Delete Feature"');
  });

  it('renders the add action next to the rows', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps()} />);

    expect(html).toContain('>Add type<');
  });

  it('renders the issues in an alert before the rows', () => {
    const html = renderToStaticMarkup(
      <TypesTab {...makeProps({ issues: ['Add at least one task type.', 'Duplicate type id "task".'] })} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Add at least one task type.');
    expect(html).toContain('Duplicate type id &quot;task&quot;.');
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('data-type="task"'));
  });

  it('renders the empty state with the add action when there are no types', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps({ draft: { types: [] } })} />);

    expect(html).toContain('No task types yet');
    expect(html).toContain('Add type');
    expect(html).not.toContain('data-type=');
  });

  it('disables every control when the page is busy', () => {
    const html = renderToStaticMarkup(<TypesTab {...makeProps({ disabled: true })} />);

    expect(tagAround(html, 'aria-label="Delete Task"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Feature up"')).toContain('disabled=""');
    expect(html.match(/draggable="true"/g)).toBeNull();
  });
});
