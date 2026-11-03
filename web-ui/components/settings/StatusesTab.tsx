/**
 * web-ui/components/settings/StatusesTab.tsx — UI-35 statuses editor.
 *
 * Controlled and hook-free on purpose: every piece of state (the draft, the
 * issues, the busy flag) lives in the page, so this renders under
 * `renderToStaticMarkup` and stays trivially testable without a DOM.
 *
 * All rules — ordering, id slugs, colour/token mapping, delete cleanup and
 * validation — come from `lib/project-settings.ts`; the component only turns
 * them into controls. Status colours are token names (`st-review`) resolved by
 * `statusDotClass`, never raw colours (DESIGN.md §3, §7).
 */

import type { DragEvent, JSX } from 'react';
import { Button, Card, CardBody, EmptyState, Input, Select } from '@/components/ui';
import { statusDotClass } from '@/lib/board';
import type { ProjectStatus, StatusCategory } from '@/lib/api-client';
import {
  CATEGORY_COLOR,
  STATUS_COLOR_LABELS,
  STATUS_CATEGORIES,
  STATUS_COLOR_TOKENS,
  idFromLabel,
  moveStatus,
  moveStatusTo,
  updateStatus,
  withoutStatuses,
  type StatusesDraft,
} from '@/lib/project-settings';

export interface StatusesTabProps {
  draft: StatusesDraft;
  baseline: StatusesDraft;
  issues: string[];
  disabled?: boolean;
  onChange: (next: StatusesDraft) => void;
}

const CELL = 'border-b border-line px-2 py-2 align-top';
const HEAD_CELL = 'border-b border-line px-2 py-1.5 text-left text-[11px] font-medium text-muted';

export function StatusesTab({ draft, issues, disabled = false, onChange }: StatusesTabProps): JSX.Element {
  const activeDone = draft.statuses.filter((status) => !status.archived && status.category === 'done');

  function commitStatuses(statuses: ProjectStatus[]): void {
    onChange({ ...draft, statuses });
  }

  function addStatus(): void {
    const status: ProjectStatus = {
      id: idFromLabel(
        'new status',
        draft.statuses.map((item) => item.id),
        'status',
      ),
      label: 'New status',
      category: 'todo',
      color: 'st-todo',
      order: draft.statuses.length,
      archived: false,
    };
    commitStatuses([...draft.statuses, status]);
  }

  function onDragStart(event: DragEvent<HTMLTableRowElement>, index: number): void {
    if (disabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }

  function onDragOver(event: DragEvent<HTMLTableRowElement>): void {
    if (disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function onDrop(event: DragEvent<HTMLTableRowElement>, index: number): void {
    if (disabled) return;
    event.preventDefault();
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(from)) return;
    commitStatuses(moveStatusTo(draft.statuses, from, index));
  }

  const addButton = (
    <Button variant="secondary" size="sm" onClick={addStatus} disabled={disabled}>
      Add status
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      {issues.length > 0 && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-danger/40 bg-surface p-3 text-[12px] text-danger"
        >
          <p className="font-medium">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-4">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {draft.statuses.length === 0 ? (
        <EmptyState
          title="No statuses yet"
          hint="A status set needs at least one to-do and one done status."
          compact
          action={addButton}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
            <table className="min-w-full border-collapse text-[12px] text-ink">
              <thead>
                <tr>
                  <th scope="col" className={HEAD_CELL}>
                    Order
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Name
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Category
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Colour
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    New tasks
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Archived
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.statuses.map((status, index) => {
                  const isInitial = draft.initialStatuses.includes(status.id);
                  const colour = status.color ?? CATEGORY_COLOR[status.category];
                  const first = index === 0;
                  const last = index === draft.statuses.length - 1;

                  return (
                    <tr
                      key={status.id}
                      data-status={status.id}
                      draggable={!disabled}
                      onDragStart={(event) => onDragStart(event, index)}
                      onDragOver={onDragOver}
                      onDrop={(event) => onDrop(event, index)}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className={CELL}>
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${status.label} up`}
                            disabled={disabled || first}
                            onClick={() => commitStatuses(moveStatus(draft.statuses, index, -1))}
                          >
                            <span aria-hidden="true">↑</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${status.label} down`}
                            disabled={disabled || last}
                            onClick={() => commitStatuses(moveStatus(draft.statuses, index, 1))}
                          >
                            <span aria-hidden="true">↓</span>
                          </Button>
                        </div>
                      </td>
                      <td className={CELL}>
                        <Input
                          label="Name"
                          aria-label={`Name for ${status.id}`}
                          value={status.label}
                          disabled={disabled}
                          className="min-w-[7rem]"
                          onChange={(event) =>
                            commitStatuses(updateStatus(draft.statuses, status.id, { label: event.target.value }))
                          }
                        />
                      </td>
                      <td className={CELL}>
                        <Select
                          label="Category"
                          aria-label={`Category for ${status.id}`}
                          value={status.category}
                          disabled={disabled}
                          className="min-w-[7rem]"
                          onChange={(event) => {
                            const category = event.target.value as StatusCategory;
                            const patch: Partial<ProjectStatus> = { category };
                            if (colour === CATEGORY_COLOR[status.category]) patch.color = CATEGORY_COLOR[category];
                            commitStatuses(updateStatus(draft.statuses, status.id, patch));
                          }}
                        >
                          {STATUS_CATEGORIES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className={CELL}>
                        <div className="flex items-end gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`mb-[7px] h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(status)}`}
                          />
                          <Select
                            label="Colour"
                          aria-label={`Colour for ${status.id}`}
                            value={colour}
                            disabled={disabled}
                            className="min-w-[7rem]"
                            onChange={(event) =>
                              commitStatuses(updateStatus(draft.statuses, status.id, { color: event.target.value }))
                            }
                          >
                            {STATUS_COLOR_TOKENS.map((token) => (
                              <option key={token} value={token}>
                                {STATUS_COLOR_LABELS[token] ?? token}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </td>
                      <td className={CELL}>
                        <Button
                          size="sm"
                          variant="secondary"
                          className={isInitial ? 'border-line-strong bg-accent-soft' : 'bg-surface-2'}
                          aria-pressed={isInitial}
                          aria-label={`Allow new tasks in ${status.label}`}
                          disabled={disabled}
                          onClick={() =>
                            onChange({
                              ...draft,
                              initialStatuses: isInitial
                                ? draft.initialStatuses.filter((id) => id !== status.id)
                                : [...draft.initialStatuses, status.id],
                            })
                          }
                        >
                          {isInitial ? '☑ Initial' : '☐ Not initial'}
                        </Button>
                      </td>
                      <td className={CELL}>
                        <Button
                          size="sm"
                          variant="secondary"
                          className={status.archived ? 'border-line-strong bg-accent-soft' : 'bg-surface-2'}
                          aria-pressed={Boolean(status.archived)}
                          aria-label={`Archive ${status.label}`}
                          disabled={disabled}
                          onClick={() =>
                            commitStatuses(
                              updateStatus(draft.statuses, status.id, { archived: !status.archived }),
                            )
                          }
                        >
                          {status.archived ? '☑ Archived' : '☐ Archived'}
                        </Button>
                      </td>
                      <td className={CELL}>
                        <Button
                          size="sm"
                          variant="danger"
                          aria-label={`Delete ${status.label}`}
                          disabled={disabled}
                          onClick={() => onChange(withoutStatuses(draft, [status.id]))}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted sm:hidden">
            Swipe the table sideways to reach the New tasks, Archived and Actions columns.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {addButton}
            <span className="text-[11px] text-muted">
              Drag a row, or use the arrow buttons, to change the order. New tasks start in every “Initial” status.
            </span>
          </div>
        </>
      )}

      <Card>
        <CardBody>
          <Select
            label="Close status"
            hint="The status a task moves to when it is closed."
            value={draft.closeStatus}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, closeStatus: event.target.value })}
          >
            {activeDone.length === 0 && <option value="">No active done status</option>}
            {activeDone.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </Select>
        </CardBody>
      </Card>
    </div>
  );
}
