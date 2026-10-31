/**
 * web-ui/components/board/MoveMenu.tsx — keyboard "Move to…" menu (V-04).
 *
 * A native `<details>` disclosure with one real button per *allowed* target.
 * Forbidden statuses are never rendered, so the menu cannot offer a move the
 * server would reject. Deliberately hook-free: it must render on the server
 * (component test) and needs no state — choosing an item closes the disclosure
 * through the DOM and then calls `onMove`.
 */

import type { ProjectStatus } from '../../lib/api-client';
import { statusDotClass } from '../../lib/board';
import { IconChevronDown } from '../icons';

export interface MoveMenuProps {
  /** Title of the card, so the disclosure has a unique accessible name. */
  taskTitle: string;
  /** Allowed target statuses, already filtered by the transition graph. */
  targets: ProjectStatus[];
  onMove: (to: string) => void;
}

export function MoveMenu({ taskTitle, targets, onMove }: MoveMenuProps) {
  if (targets.length === 0) return null;

  return (
    <details className="relative">
      <summary
        aria-label={`Move “${taskTitle}” to another status`}
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-1 text-[11px] font-medium text-muted transition duration-150 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden"
      >
        Move to…
        <IconChevronDown className="h-3 w-3" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-pop)]">
        <ul className="p-1">
          {targets.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  onMove(target.id);
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[12px] text-ink transition duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(target)}`}
                  aria-hidden="true"
                />
                {target.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
