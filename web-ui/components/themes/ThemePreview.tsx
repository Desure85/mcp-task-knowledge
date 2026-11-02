'use client';

import type { CSSProperties } from 'react';
import { Badge, Button, Card, CardBody, Input } from '@/components/ui';
import { COLOR_TOKENS } from '@/lib/theme-tokens';
import type { ThemeMode, TokenMap } from '@/lib/custom-theme';

/** A small slice of the real UI painted with the drafted tokens. */
export function ThemePreview({ tokens, mode }: { tokens: TokenMap; mode: ThemeMode }) {
  const style: Record<string, string> = {};
  for (const token of COLOR_TOKENS) style[`--${token}`] = tokens[token];
  return (
    <div
      data-mode={mode}
      style={{ ...(style as unknown as CSSProperties), colorScheme: mode }}
      className="space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3 text-ink"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="danger">Danger</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Badge tone="todo">Todo</Badge>
        <Badge tone="doing">Doing</Badge>
        <Badge tone="done">Done</Badge>
        <Badge tone="blocked">Blocked</Badge>
        <Badge tone="high">High</Badge>
      </div>
      <Card>
        <CardBody className="space-y-1">
          <p className="text-[13px] font-semibold text-ink">Card title</p>
          <p className="text-[11px] text-muted">Muted copy uses the derived muted token.</p>
        </CardBody>
      </Card>
      <Input label="Field label" defaultValue="Value" hint="Hint text" />
    </div>
  );
}
