import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesignShowcase } from './DesignShowcase';


export const metadata: Metadata = {
  title: 'Design system — dev only',
  robots: { index: false, follow: false },
};

/**
 * Dev-only showcase for the UI-10 primitives. Hidden in production builds
 * (unless explicitly requested); no navigation entry points to it.
 */
export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DesignShowcase />;
}
