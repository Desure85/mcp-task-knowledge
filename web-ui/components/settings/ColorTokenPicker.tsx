'use client';

/**
 * UI-40 — swatch grid for status/type palette tokens.
 *
 * Only token names are stored; the swatch resolves `var(--token)`, and the two
 * chips preview the same token as a `color-mix` tint on light and dark.
 */
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui';

export interface ColorTokenPickerProps {
  tokens: readonly string[];
  labels: Record<string, string>;
  value: string;
  onChange: (token: string) => void;
  label: string;
  disabled?: boolean;
}

export function ColorTokenPicker({ tokens, labels, value, onChange, label, disabled }: ColorTokenPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {tokens.map((token) => {
        const name = labels[token] ?? token;
        return (
          <Button
            key={token}
            type="button"
            role="radio"
            aria-checked={value === token}
            aria-label={`${name} (${token})`}
            variant="secondary"
            size="sm"
            disabled={disabled}
            className={`justify-start gap-1.5 px-2 ${value === token ? 'border-line-strong bg-accent-soft' : ''}`}
            onClick={() => onChange(token)}
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full border border-line"
              style={{ '--token': `var(--${token})`, backgroundColor: `var(--${token})` } as CSSProperties}
            />
            <span className="truncate text-11">{name}</span>
            <span aria-hidden="true" className="ml-auto flex items-center gap-0.5">
              <span className="color-token-preview-light" style={{ '--token': `var(--${token})` } as CSSProperties}>Aa</span>
              <span className="color-token-preview-dark" style={{ '--token': `var(--${token})` } as CSSProperties}>Aa</span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
