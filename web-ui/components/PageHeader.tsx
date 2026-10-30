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
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className ?? ''}`}>
      <div className="min-w-0">
        <h2 className="text-[20px] font-semibold leading-tight tracking-tight text-neutral-900">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
