/**
 * web-ui/components/BrandMark.tsx — Indigo "M" product mark.
 *
 * One primitive for the sidebar brand row and the sign-in screen so the mark
 * never drifts between shell and authentication surfaces.
 */

type BrandMarkProps = {
  size?: 'sm' | 'md';
  className?: string;
};

const SIZES: Record<'sm' | 'md', string> = {
  sm: 'h-7 w-7 rounded-lg text-[12px]',
  md: 'h-10 w-10 rounded-xl text-[15px]',
};

export function BrandMark({ size = 'sm', className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center bg-indigo-600 font-bold text-white shadow-sm ${SIZES[size]} ${className ?? ''}`}
    >
      M
    </span>
  );
}
