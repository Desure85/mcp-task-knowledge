/**
 * web-ui/components/PriorityDot.tsx — Dot + label priority marker.
 */

export type Priority = 'low' | 'medium' | 'high';

const DOTS: Record<Priority, string> = {
  high: 'bg-pr-high',
  medium: 'bg-pr-med',
  low: 'bg-pr-low',
};

const LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

type PriorityDotProps = {
  priority: Priority;
  withLabel?: boolean;
  className?: string;
};

export function PriorityDot({ priority, withLabel = true, className }: PriorityDotProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`} title={`Priority: ${LABELS[priority]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[priority]}`} aria-hidden="true" />
      <span className="text-[11px] text-muted">{LABELS[priority]}</span>
      {!withLabel && <span className="sr-only">{LABELS[priority]}</span>}
    </span>
  );
}
