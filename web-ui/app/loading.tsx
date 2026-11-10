import { SkeletonCard } from '@/components/ui';

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3" aria-busy="true" aria-label="Loading">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
