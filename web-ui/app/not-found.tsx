import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-[24px] font-semibold text-ink">Page not found</h1>
      <p className="mt-3 text-[13px] text-muted">
        The page you are looking for does not exist or has moved.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-8 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-[12px] font-medium text-ink transition hover:bg-surface-2"
      >
        Back to Overview
      </Link>
    </div>
  );
}
