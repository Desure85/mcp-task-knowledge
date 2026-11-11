'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ColorField,
  Dialog,
  EmptyState,
  FileInput,
  Input,
  Select,
  Skeleton,
  SkeletonCard,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { THEMES, THEME_LABELS, MODE_LABELS, type ModeChoice, type ThemeName } from '@/lib/theme';
import { DEFAULT_BASE } from '@/lib/custom-theme';
import { HUE_COLOR_TOKENS, THEME_COLOR_TOKENS } from '@/lib/theme-pairs';
import { STATUS_COLOR_LABELS } from '@/lib/project-settings';

const SHOWCASE_MODES: Array<Extract<ModeChoice, 'light' | 'dark'>> = ['light', 'dark'];

const BADGES = [
  ['neutral', 'Neutral'],
  ['todo', 'Todo'],
  ['doing', 'In progress'],
  ['review', 'Review'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['bug', 'Bug'],
  ['feature', 'Feature'],
  ['task', 'Task'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
] as const;

function Variant({ theme, mode }: { theme: ThemeName; mode: ModeChoice }) {
  const [dialog, setDialog] = useState(false);
  const [color, setColor] = useState(DEFAULT_BASE.light.accent);
  return (
    <section
      data-theme={theme}
      data-mode={mode}
      className="rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-ink"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">
          {THEME_LABELS[theme]} · {MODE_LABELS[mode]}
        </h2>
        <code className="font-mono text-[11px] text-muted">
          data-theme=&quot;{theme}&quot; data-mode=&quot;{mode}&quot;
        </code>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Buttons</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Fields</p>
          <Input label="Task title" placeholder="Write a title" hint="Label is wired to the input." />
          <Input label="Broken field" defaultValue="value" error="This field is required." />
          <Select label="Priority" defaultValue="medium">
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
          <Textarea label="Notes" placeholder="Markdown is fine" hint="Focus ring uses the palette token." />
          <ColorField
            label="Accent colour"
            value={color}
            onChange={setColor}
            hint="Swatch or text: hex, rgb() or hsl()."
          />
          <FileInput label="Theme JSON" onFile={() => undefined} hint="Import a theme file." />

          <div className="flex items-center gap-3">
            <Tooltip label="Tooltip on hover and focus">
              <Button size="sm" variant="secondary">Hover me</Button>
            </Tooltip>
            <Button size="sm" variant="danger" onClick={() => setDialog(true)}>Open dialog</Button>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Card & badges</p>
          <Card>
            <CardHeader className="text-[12px] font-semibold">Lease card</CardHeader>
            <CardBody className="space-y-2">
              <p className="text-[12px] text-muted">Agent holds this task for 14m of 30m.</p>
              <div className="flex flex-wrap gap-1">
                {BADGES.map(([tone, label]) => (
                  <Badge key={tone} tone={tone}>{label}</Badge>
                ))}
              </div>
            </CardBody>
          </Card>

          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Loading / empty</p>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <SkeletonCard />
          <EmptyState title="Nothing here yet" hint="Empty state uses the same tokens." />
        </div>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Delete document?"
        description="This is the window.confirm replacement: focus trap, Escape, labelled dialog."
        destructive
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setDialog(false)}>Delete</Button>
          </>
        }
      />
    </section>
  );
}

export function DesignShowcase() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Design system</h1>
        <p className="mt-1 text-[12px] text-muted">
          Dev-only showcase: six palette × mode variants, primitives only from CSS tokens.
        </p>
      </header>
      {/* UI-40: palette names are data; colours always come from theme tokens. */}
      <section className="rounded-card border border-line bg-surface p-3">
        <h2 className="text-14 font-semibold text-ink">Status &amp; type palette</h2>
        <p className="mt-1 text-12 text-muted">
          Stored values are token names. Hue tokens and theme links replace the six legacy status names;
          the old names stay valid.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {[...HUE_COLOR_TOKENS, ...THEME_COLOR_TOKENS].map((token) => (
            <div key={token} className="rounded-control border border-line bg-canvas p-1.5">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 rounded-full border border-line"
                  style={{ backgroundColor: `var(--${token})` }}
                />
                <span className="truncate text-11 text-ink">{STATUS_COLOR_LABELS[token] ?? token}</span>
              </span>
              <span aria-hidden="true" className="mt-1 flex gap-0.5">
                <span
                  className="color-token-preview-light"
                  style={{ '--token': `var(--${token})` } as CSSProperties}
                >
                  Aa
                </span>
                <span
                  className="color-token-preview-dark"
                  style={{ '--token': `var(--${token})` } as CSSProperties}
                >
                  Aa
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        {THEMES.flatMap((theme) =>
          SHOWCASE_MODES.map((mode) => <Variant key={`${theme}-${mode}`} theme={theme} mode={mode} />),
        )}
      </div>
    </div>
  );
}
