/**
 * web-ui/components/settings/TransitionsTab.tsx — UI-35 tab 2: the transition matrix.
 *
 * A controlled, hook-free view of `TransitionsDraft`: the page owns the draft
 * and this component only renders it and calls `onChange` with the next one.
 * Three zones:
 *
 *   A. the "any status → any status" toggle (`transitions === null`);
 *   B. the from × to matrix — a real table, one row per active status;
 *   C. the client mirror of the server reachability rule, which names the
 *      done statuses that cannot be reached from the initial statuses.
 *
 * State is never carried by colour alone: pressed cells show "✓" vs "·" plus
 * `aria-pressed`, unreachable columns carry the "(unreachable)" marker text and
 * `data-unreachable`. Colours are semantic tokens only (DESIGN.md §7).
 */

import type { JSX } from 'react';
import type { ProjectStatus } from '@/lib/api-client';
import type { TransitionsDraft } from '@/lib/project-settings';
import {
  activeStatuses,
  fullMatrix,
  isTransitionAllowed,
  toggleTransition,
  unreachableDoneMessage,
  unreachableDoneStatuses,
} from '@/lib/project-settings';
import { Button, Card, CardBody, CardHeader, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface TransitionsTabProps {
  draft: TransitionsDraft;
  /** Saved status set (server), already ordered. */
  statuses: ProjectStatus[];
  /** Saved initial statuses, used to explain unreachable done statuses. */
  initialStatuses: string[];
  /** Client-side validation hints; the server stays the authority. */
  issues: string[];
  /** Disables every control while the page is saving. */
  disabled?: boolean;
  onChange: (next: TransitionsDraft) => void;
}

export function TransitionsTab({
  draft,
  statuses,
  initialStatuses,
  issues,
  disabled = false,
  onChange,
}: TransitionsTabProps): JSX.Element {
  const active = activeStatuses(statuses);
  const unrestricted = draft.transitions === null;
  const tooFew = active.length < 2;
  // With fewer than two statuses there is no matrix to reason about, so the
  // reachability hint would only echo a set the user cannot fix from here.
  const unreachable = tooFew ? [] : unreachableDoneStatuses(statuses, initialStatuses, draft.transitions);
  const unreachableSet = new Set(unreachable);

  return (
    <Card>
      <CardHeader className="text-[12px] font-semibold text-ink">Transitions</CardHeader>
      <CardBody className="flex flex-col gap-3">
        {issues.length > 0 && (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-danger/40 bg-surface p-2.5 text-[11px] text-danger"
          >
            <ul className="list-disc pl-4">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className={unrestricted ? 'border-line-strong bg-accent-soft' : undefined}
            aria-pressed={unrestricted}
            aria-label="Allow any transition"
            disabled={disabled || tooFew}
            onClick={() => {
              onChange(unrestricted ? { transitions: fullMatrix(active) } : { transitions: null });
            }}
          >
            {unrestricted ? 'Any status → any status' : 'Restricted transitions'}
          </Button>
          <span className="text-[11px] text-muted">
            {unrestricted
              ? 'Every active status may move to every other. Turn this off to edit the matrix.'
              : 'Only the ticked cells are allowed.'}
          </span>
        </div>

        {tooFew ? (
          <EmptyState
            compact
            title="Transitions need at least two statuses"
            hint="Add another active status on the Statuses tab, then come back to choose the allowed moves."
          />
        ) : (
          <>
            {unreachable.length > 0 && (
              <div
                role="alert"
                className="rounded-[var(--radius-card)] border border-danger/40 bg-surface p-2.5 text-[11px] text-danger"
              >
                {unreachableDoneMessage(statuses, unreachable, initialStatuses)}
              </div>
            )}

            {unrestricted && (
              <p className="text-[11px] text-muted">
                Any status → any status is on, so every cell is shown as allowed. Turn it off to edit the matrix.
              </p>
            )}

            <p className="text-[11px] text-muted">
              Legend: <span aria-hidden="true">✓</span> allowed, <span aria-hidden="true">·</span> not allowed,{' '}
              <span aria-hidden="true">—</span> same status.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-[11px]">
                <caption className="pb-2 text-left text-[11px] text-muted">
                  Allowed transitions, rows = from, columns = to
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border border-line bg-surface-2 px-2 py-1 text-left font-medium text-muted"
                    >
                      From \ To
                    </th>
                    {active.map((status) => {
                      const isUnreachable = unreachableSet.has(status.id);
                      return (
                        <th
                          key={status.id}
                          scope="col"
                          className={cn(
                            'border bg-surface-2 px-2 py-1 text-center font-medium',
                            isUnreachable ? 'border-danger text-danger' : 'border-line text-ink',
                          )}
                        >
                          {status.label}
                          {isUnreachable && <span className="ml-1 whitespace-nowrap text-[10px]">(unreachable)</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {active.map((fromStatus) => (
                    <tr key={fromStatus.id}>
                      <th
                        scope="row"
                        className="border border-line bg-surface-2 px-2 py-1 text-left font-medium text-ink"
                      >
                        {fromStatus.label}
                      </th>
                      {active.map((toStatus) => {
                        const diagonal = fromStatus.id === toStatus.id;
                        const pressed = isTransitionAllowed(draft.transitions, fromStatus.id, toStatus.id);
                        const isUnreachable = unreachableSet.has(toStatus.id);
                        return (
                          <td
                            key={toStatus.id}
                            data-unreachable={isUnreachable ? 'true' : undefined}
                            className={cn(
                              'border p-1 text-center',
                              isUnreachable ? 'border-danger' : 'border-line',
                            )}
                          >
                            {diagonal ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled
                                aria-label={`Same status: ${fromStatus.label}`}
                                className="text-muted"
                              >
                                —
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                aria-pressed={pressed}
                                aria-label={`Allow ${fromStatus.label} → ${toStatus.label}`}
                                disabled={disabled || unrestricted}
                                className={cn(
                                  'w-full',
                                  pressed ? 'border-line-strong bg-accent-soft' : 'text-muted',
                                )}
                                onClick={() =>
                                  onChange(toggleTransition(draft, statuses, fromStatus.id, toStatus.id))
                                }
                              >
                                {pressed ? '✓' : '·'}
                              </Button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
