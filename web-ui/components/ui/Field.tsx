'use client';

import { useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
}

function FieldShell({ label, hint, error, htmlFor, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[11px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-[11px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full rounded-[var(--radius-control)] border bg-surface px-2 py-1 text-[12px] text-ink placeholder:text-muted ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/30 disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${inputId}-hint` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ') || undefined}
        className={cn(CONTROL, error ? 'border-danger' : 'border-line', className)}
      />
    </FieldShell>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Select({ label, hint, error, id, className, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={selectId}>
      <select
        {...rest}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${selectId}-hint` : null, error ? `${selectId}-error` : null].filter(Boolean).join(' ') || undefined}
        className={cn(CONTROL, error ? 'border-danger' : 'border-line', className)}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, id, className, ...rest }: TextareaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={areaId}>
      <textarea
        {...rest}
        id={areaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${areaId}-hint` : null, error ? `${areaId}-error` : null].filter(Boolean).join(' ') || undefined}
        className={cn(CONTROL, 'min-h-20', error ? 'border-danger' : 'border-line', className)}
      />
    </FieldShell>
  );
}
