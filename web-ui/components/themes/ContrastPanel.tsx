'use client';

import { Badge, Card, CardBody, CardHeader } from '@/components/ui';
import { pairKey, type ContrastPair } from '@/lib/theme-pairs';
import type { ModeAnalysis, PairCheck } from '@/lib/custom-theme';

const PAIR_LABELS: Record<string, string> = {
  'ink/canvas': 'Text / canvas',
  'ink/surface': 'Text / surface',
  'ink/surface-2': 'Text / raised',
  'muted/canvas': 'Muted / canvas',
  'muted/surface': 'Muted / surface',
  'muted/surface-2': 'Muted / raised',
  'accent/canvas': 'Accent / canvas',
  'accent/surface': 'Accent / surface',
  'on-accent/accent': 'Button label / accent',
  'line-strong/canvas': 'Strong border / canvas',
  'focus-ring/canvas': 'Focus ring / canvas',
};

export function pairLabel(pair: ContrastPair): string {
  return PAIR_LABELS[pairKey(pair)] ?? pairKey(pair);
}

function Row({ check }: { check: PairCheck }) {
  return (
    <tr>
      <td className="border-b border-line py-1 pr-2 text-ink">
        {pairLabel(check.pair)}
        {check.critical && <span className="ml-1 text-[10px] text-muted">critical</span>}
      </td>
      <td className="tnum border-b border-line py-1 pr-2 text-ink">{check.ratio.toFixed(2)}:1</td>
      <td className="tnum border-b border-line py-1 pr-2 text-muted">{check.threshold}:1</td>
      <td className="border-b border-line py-1">
        <Badge tone={check.pass ? 'done' : check.critical ? 'blocked' : 'medium'}>
          {check.pass ? 'Pass' : check.critical ? 'Blocking' : 'Advisory'}
        </Badge>
      </td>
    </tr>
  );
}

export function ContrastPanel({ analysis }: { analysis: ModeAnalysis }) {
  const { derivation, checks } = analysis;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <span>Contrast · {analysis.mode === 'light' ? 'Light' : 'Dark'}</span>
        {derivation.ok ? (
          <Badge tone="done">AA by construction</Badge>
        ) : (
          <Badge tone="blocked">Blocked</Badge>
        )}
      </CardHeader>
      <CardBody className="space-y-2">
        {!derivation.ok && (
          <p role="alert" className="text-[11px] text-danger">
            {derivation.error}
          </p>
        )}
        {derivation.ok && derivation.warnings.length > 0 && (
          <ul className="space-y-1 text-[11px] text-warning">
            {derivation.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-line py-1 pr-2 font-medium">Pair</th>
              <th className="border-b border-line py-1 pr-2 font-medium">Ratio</th>
              <th className="border-b border-line py-1 pr-2 font-medium">Need</th>
              <th className="border-b border-line py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <Row key={check.key} check={check} />
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
