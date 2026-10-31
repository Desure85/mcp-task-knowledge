import { cn } from '@/lib/cn';

/** Loading placeholder for a line or a block; replaces "Loading..." text. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[var(--radius-control)] bg-surface-2', className ?? 'h-3 w-full')} />;
}

/** Card-shaped skeleton for lists that load as cards. */
export function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="mt-2 h-3 w-2/3" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-10" />
      </div>
    </div>
  );
}
