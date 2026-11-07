/**
 * web-ui/components/settings/TypesTab.tsx — UI-35 task type editor.
 *
 * Controlled and hook-free on purpose: the draft, the validation issues and the
 * busy flag all live in the page, so this renders under `renderToStaticMarkup`
 * and stays testable without a DOM.
 *
 * All rules — reordering, id slugs, delete cleanup and the token/icon vocabulary
 * — come from `lib/project-settings.ts`; the component only turns them into
 * controls. The server has no `order` field for types, so the array order *is*
 * the order: drag & drop and the arrow buttons reorder the array itself.
 *
 * Colours are token names (`ty-bug`) resolved by `typeDotClass`, never raw
 * colours (DESIGN.md §3, §7); icons are the three glyphs of `TypeIcon`.
 */

import type { DragEvent, JSX } from 'react';
import { TypeIcon } from '@/components/board/TypeIcon';
import { Button, EmptyState, Input, Select } from '@/components/ui';
import type { ProjectType } from '@/lib/api-client';
import { typeDotClass } from '@/lib/board-lanes';
import {
  TYPE_COLOR_LABELS,
  TYPE_COLOR_TOKENS,
  TYPE_ICON_LABELS,
  TYPE_ICONS,
  idFromLabel,
  moveType,
  moveTypeTo,
  updateType,
  withoutTypes,
  type TypesDraft,
} from '@/lib/project-settings';

export interface TypesTabProps {
  draft: TypesDraft;
  baseline: TypesDraft;
  issues: string[];
  disabled?: boolean;
  onChange: (next: TypesDraft) => void;
}

const CELL = 'border-b border-line px-2 py-2 align-middle';
const HEAD_CELL = 'border-b border-line px-2 py-1.5 text-left text-[11px] font-medium text-muted';

/** The glyph `TypeIcon` actually shows: an explicit icon wins, then the id. */
function iconValue(type: ProjectType): (typeof TYPE_ICONS)[number] {
  const candidate = `${type.icon ?? type.id ?? ''}`.trim().toLowerCase();
  return (TYPE_ICONS as readonly string[]).includes(candidate)
    ? (candidate as (typeof TYPE_ICONS)[number])
    : 'task';
}

export function TypesTab({ draft, issues, disabled = false, onChange }: TypesTabProps): JSX.Element {
  function commitTypes(types: ProjectType[]): void {
    onChange({ types });
  }

  function addType(): void {
    const type: ProjectType = {
      id: idFromLabel(
        'new type',
        draft.types.map((item) => item.id),
        'type',
      ),
      label: 'New type',
      color: 'ty-task',
      icon: 'task',
    };
    commitTypes([...draft.types, type]);
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
    commitTypes(moveTypeTo(draft.types, from, index));
  }

  const addButton = (
    <Button variant="secondary" size="sm" onClick={addType} disabled={disabled}>
      Add type
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

      {draft.types.length === 0 ? (
        <EmptyState
          title="No task types yet"
          hint="Add at least one type so tasks can be grouped into type lanes."
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
                    Colour
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Icon
                  </th>
                  <th scope="col" className={HEAD_CELL}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.types.map((type, index) => {
                  const colour = type.color ?? 'ty-task';
                  const first = index === 0;
                  const last = index === draft.types.length - 1;

                  return (
                    <tr
                      key={type.id}
                      data-type={type.id}
                      draggable={!disabled}
                      onDragStart={(event) => onDragStart(event, index)}
                      onDragOver={onDragOver}
                      onDrop={(event) => onDrop(event, index)}
                      className="border-b border-line last:border-b-0"
                    >
                      <td className={CELL}>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            aria-label={`Move ${type.label} up`}
                            disabled={disabled || first}
                            onClick={() => commitTypes(moveType(draft.types, index, -1))}
                          >
                            <span aria-hidden="true">↑</span>
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`Move ${type.label} down`}
                            disabled={disabled || last}
                            onClick={() => commitTypes(moveType(draft.types, index, 1))}
                          >
                            <span aria-hidden="true">↓</span>
                          </Button>
                        </div>
                      </td>
                      <td className={CELL}>
                        <Input
                          label="Name"
                          hideLabel
                          aria-label={`Name for ${type.id}`}
                          value={type.label}
                          disabled={disabled}
                          className="min-w-[7rem]"
                          onChange={(event) =>
                            commitTypes(updateType(draft.types, type.id, { label: event.target.value }))
                          }
                        />
                      </td>
                      <td className={CELL}>
                        <div className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${typeDotClass(type)}`}
                          />
                          <Select
                            label="Colour"
                            hideLabel
                            aria-label={`Colour for ${type.id}`}
                            value={colour}
                            disabled={disabled}
                            className="min-w-[7rem]"
                            onChange={(event) =>
                              commitTypes(updateType(draft.types, type.id, { color: event.target.value }))
                            }
                          >
                            {TYPE_COLOR_TOKENS.map((token) => (
                              <option key={token} value={token}>
                                {TYPE_COLOR_LABELS[token] ?? token}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </td>
                      <td className={CELL}>
                        <div className="flex items-center gap-1.5">
                          <span aria-hidden="true" className="inline-flex text-ink">
                            <TypeIcon icon={type.icon} type={type.id} />
                          </span>
                          <Select
                            label="Icon"
                            hideLabel
                            aria-label={`Icon for ${type.id}`}
                            value={iconValue(type)}
                            disabled={disabled}
                            className="min-w-[7rem]"
                            onChange={(event) =>
                              commitTypes(updateType(draft.types, type.id, { icon: event.target.value }))
                            }
                          >
                            {TYPE_ICONS.map((icon) => (
                              <option key={icon} value={icon}>
                                {TYPE_ICON_LABELS[icon] ?? icon}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </td>
                      <td className={CELL}>
                        <Button
                          variant="danger"
                          aria-label={`Delete ${type.label}`}
                          disabled={disabled}
                          onClick={() => onChange(withoutTypes(draft, [type.id]))}
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

          <div className="flex flex-wrap items-center gap-2">
            {addButton}
            <span className="text-[11px] text-muted">
              Drag a row, or use the arrow buttons, to change the order. Colours and icons are design tokens.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
