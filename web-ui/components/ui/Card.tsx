import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div
      {...rest}
      className={cn('rounded-[var(--radius-card)] border border-line bg-surface', className)}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('border-b border-line px-3 py-2', className)}>{children}</div>;
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cn('p-3', className)}>{children}</div>;
}
