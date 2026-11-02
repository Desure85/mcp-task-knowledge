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

/** Single-line text field with a visible label, optional hint and error. */
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

/** Native select with a visible label; use it for short, known option lists. */
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

/** Multi-line text field (markdown, descriptions) with a visible label. */
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

export interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  id?: string;
}

/** Colour value as a native swatch plus a text field for hex/rgb()/hsl(). */
export function ColorField({ label, value, onChange, hint, error, id }: ColorFieldProps) {
  const autoId = useId();
  const textId = id ?? autoId;
  const swatchId = `${textId}-swatch`;
  const hasSwatch = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={textId}>
      <div className="flex items-center gap-1">
        {hasSwatch ? (
          <input
            id={swatchId}
            type="color"
            aria-label={`${label}: colour picker`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-8 w-9 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface p-0.5"
          />
        ) : (
          <span
            aria-hidden="true"
            className="h-8 w-9 shrink-0 rounded-[var(--radius-control)] border border-line bg-surface-2"
          />
        )}
        <input
          id={textId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? `${textId}-hint` : null, error ? `${textId}-error` : null].filter(Boolean).join(' ') || undefined}
          placeholder="hex, rgb() or hsl()"
          spellCheck={false}
          autoComplete="off"
          className={cn(CONTROL, error ? 'border-danger' : 'border-line')}
        />
      </div>
    </FieldShell>
  );
}

export interface FileInputProps {
  label: string;
  onFile: (file: File) => void;
  accept?: string;
  hint?: string;
}

/** File picker with a visible label; the callback gets the chosen file once. */
export function FileInput({ label, onFile, accept = '.json,application/json', hint }: FileInputProps) {
  const fileId = useId();
  return (
    <FieldShell label={label} hint={hint} htmlFor={fileId}>
      <input
        id={fileId}
        type="file"
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = '';
        }}
        className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[12px] text-ink file:mr-2 file:rounded-[var(--radius-control)] file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-[11px] file:text-ink"
      />
    </FieldShell>
  );
}
