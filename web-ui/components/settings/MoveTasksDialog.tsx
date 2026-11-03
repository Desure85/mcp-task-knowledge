/**
 * web-ui/components/settings/MoveTasksDialog.tsx — UI-35 "move the tasks first".
 *
 * The server refuses to delete a status/type that tasks still use
 * (`STATUS_IN_USE` / `TYPE_IN_USE`) and returns the offending ids plus up to 20
 * task ids. Instead of showing a raw error we show what is blocked and let the
 * user pick one destination; the page then retries the same Save with `moves`.
 *
 * Controlled and hook-free: the dialog state (which removals are blocked, the
 * chosen target) lives in the page, so this renders on the server too and obeys
 * the DESIGN.md ban on `window.confirm`.
 */

import { Badge, Button, Dialog, Select } from '@/components/ui';

export interface BlockedRemoval {
  /** Status/type id that cannot be removed. */
  id: string;
  /** Human label of that status/type. */
  label: string;
  /** How many tasks still use it. */
  total: number;
  /** Up to 20 task ids reported by the server. */
  taskIds: string[];
}

export interface MoveTargetOption {
  id: string;
  label: string;
}

export interface MoveTasksDialogProps {
  open: boolean;
  kind: 'status' | 'type';
  blocked: BlockedRemoval[];
  options: MoveTargetOption[];
  target: string;
  busy?: boolean;
  onTargetChange: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MoveTasksDialog({
  open,
  kind,
  blocked,
  options,
  target,
  busy = false,
  onTargetChange,
  onCancel,
  onConfirm,
}: MoveTasksDialogProps) {
  const noun = kind === 'status' ? 'status' : 'type';
  const total = blocked.reduce((sum, item) => sum + item.total, 0);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={`Move tasks before deleting this ${noun}`}
      description={
        total > 0
          ? `${total} ${total === 1 ? 'task still uses' : 'tasks still use'} ${blocked.length === 1 ? `this ${noun}` : `these ${noun}s`}.`
          : `Choose where the tasks should go, then the ${noun} can be deleted.`
      }
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={!target} loading={busy}>
            Move tasks and save
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {blocked.map((item) => (
          <li key={item.id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{item.label}</span>
              <Badge tone="neutral">
                {item.total} {item.total === 1 ? 'task' : 'tasks'}
              </Badge>
            </div>
            {item.taskIds.length > 0 && (
              <p className="font-mono text-[11px] leading-4 text-muted">
                <span className="font-sans">Task ids: </span>
                {item.taskIds.join(', ')}
                {item.total > item.taskIds.length ? ` … +${item.total - item.taskIds.length} more` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Select
          label={`Move these tasks to`}
          value={target}
          onChange={(event) => onTargetChange(event.target.value)}
          hint={`Only ${noun}s that stay in the set can receive the tasks.`}
        >
          <option value="">{`Choose a ${noun}…`}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
    </Dialog>
  );
}
