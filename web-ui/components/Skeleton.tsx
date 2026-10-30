/**
 * web-ui/components/Skeleton.tsx — Loading placeholders.
 */

type SkeletonProps = { className?: string };

export function Skeleton({ className }: SkeletonProps) {
  return <div className={`animate-pulse rounded-[var(--radius-control)] bg-surface-2 ${className ?? 'h-3 w-full'}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="mt-2 h-3 w-2/3" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-4 w-12 rounded-md" />
        <Skeleton className="h-4 w-10 rounded-md" />
      </div>
    </div>
  );
}

export function SkeletonColumn({ cards = 3 }: { cards?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface-2 p-3">
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-6 rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: cards }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
