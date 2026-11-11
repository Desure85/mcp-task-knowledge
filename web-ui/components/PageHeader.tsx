/**
 * web-ui/components/PageHeader.tsx — In-canvas page heading with actions.
 */

import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 max-lg:sticky max-lg:top-[calc(var(--spacing-topbar)+var(--spacing-mobile-nav))] max-lg:z-20 max-lg:border-b max-lg:border-line max-lg:bg-surface/95 max-lg:py-2 max-lg:backdrop-blur sm:flex-row sm:items-start sm:justify-between ${className ?? ''}`}>
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
