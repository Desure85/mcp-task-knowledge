/**
 * web-ui/components/PriorityDot.tsx — Dot + label priority marker.
 */

export type Priority = 'low' | 'medium' | 'high';

const DOTS: Record<Priority, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-neutral-400',
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
      <span className="text-[11px] text-neutral-500">{LABELS[priority]}</span>
      {!withLabel && <span className="sr-only">{LABELS[priority]}</span>}
    </span>
  );
}
