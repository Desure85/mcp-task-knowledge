/**
 * web-ui/components/settings/statuses-tab.test.tsx — UI-35 statuses editor.
 *
 * Server-rendered contract: the tab is hook-free on purpose, so
 * `renderToStaticMarkup` asserts the rows, the order buttons' disabled edges,
 * the category/colour selects, the initial/archived toggles, the close-status
 * select, the issue alert, the per-row delete labels and the drag handle.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectStatus } from '@/lib/api-client';
import type { StatusesDraft } from '@/lib/project-settings';
import { StatusesTab, type StatusesTabProps } from './StatusesTab';

/** Rows are deliberately First, Third, Second so the middle row and the last row differ. */
const FIRST: ProjectStatus = {
  id: 'first',
  label: 'First',
  category: 'todo',
  color: 'st-todo',
  order: 0,
};
const THIRD: ProjectStatus = {
  id: 'third',
  label: 'Third',
  category: 'done',
  color: 'st-done',
  order: 1,
};
const SECOND: ProjectStatus = {
  id: 'second',
  label: 'Second',
  category: 'in_progress',
  color: 'st-review',
  order: 2,
};

function makeDraft(overrides: Partial<StatusesDraft> = {}): StatusesDraft {
  return {
    statuses: [FIRST, THIRD, SECOND],
    closeStatus: 'third',
    initialStatuses: ['first'],
    ...overrides,
  };
}

function makeProps(overrides: Partial<StatusesTabProps> = {}): StatusesTabProps {
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

describe('StatusesTab', () => {
  it('renders one row per status with its id and current name', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(html).toContain('data-status="first"');
    expect(html).toContain('data-status="third"');
    expect(html).toContain('data-status="second"');
    expect(html).toContain('value="First"');
    expect(html).toContain('value="Third"');
    expect(html).toContain('value="Second"');
    expect(html).toContain('Name for first');
    expect(html).toContain('Name for second');
  });

  it('makes every row draggable', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(html.match(/draggable="true"/g)).toHaveLength(3);
  });

  it('disables the first up arrow and the last down arrow, keeps the middle enabled', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(tagAround(html, 'aria-label="Move First up"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Second down"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Second up"')).not.toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Third up"')).not.toContain('disabled=""');
  });

  it('renders the category select with the status category selected', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);
    const selected = selectedOptionValues(html);

    expect(html).toContain('Category for second');
    expect(selected).toContain('todo');
    expect(selected).toContain('in_progress');
    expect(selected).toContain('done');
  });

  it('offers every colour token and selects the status token', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(html).toContain('aria-label="Secondary (st-review)"');
    expect(html).toContain('aria-label="Success (st-done)"');
    expect(html).toContain('aria-label="Slate (st-slate)"');
    expect(html).toContain('color-token-preview-light');
    expect(html).toContain('color-token-preview-dark');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('bg-st-review');
  });

  it('marks initial statuses with aria-pressed and a text state', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(tagAround(html, 'aria-label="Allow new tasks in First"')).toContain('aria-pressed="true"');
    expect(tagAround(html, 'aria-label="Allow new tasks in Third"')).toContain('aria-pressed="false"');
    expect(html).toContain('Initial<');
    expect(html).toContain('Not initial<');
  });

  it('marks the archived state with aria-pressed and a text state', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(tagAround(html, 'aria-label="Archive First"')).toContain('aria-pressed="false"');
    expect(html).toContain('Archived<');
  });

  it('selects the draft close status among the active done statuses', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(html).toContain('Close status');
    expect(selectedOptionValues(html)).toContain('third');
  });

  it('renders the issues in an alert before the rows', () => {
    const html = renderToStaticMarkup(
      <StatusesTab {...makeProps({ issues: ['Add at least one status.', 'Choose a close status.'] })} />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Add at least one status.');
    expect(html).toContain('Choose a close status.');
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('data-status="first"'));
  });

  it('gives every delete button its own label', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps()} />);

    expect(html).toContain('aria-label="Delete First"');
    expect(html).toContain('aria-label="Delete Third"');
    expect(html).toContain('aria-label="Delete Second"');
  });

  it('renders the empty state with the add action when there are no statuses', () => {
    const html = renderToStaticMarkup(
      <StatusesTab
        {...makeProps({ draft: makeDraft({ statuses: [], closeStatus: '', initialStatuses: [] }) })}
      />,
    );

    expect(html).toContain('No statuses yet');
    expect(html).toContain('Add status');
    expect(html).not.toContain('data-status=');
  });

  it('disables every control when the page is busy', () => {
    const html = renderToStaticMarkup(<StatusesTab {...makeProps({ disabled: true })} />);

    expect(tagAround(html, 'aria-label="Delete First"')).toContain('disabled=""');
    expect(tagAround(html, 'aria-label="Move Third up"')).toContain('disabled=""');
  });
});
