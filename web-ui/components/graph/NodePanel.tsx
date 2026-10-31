'use client';

import { useMemo } from 'react';
import {
  entityMentions,
  entityNodeId,
  oftenAppearsWith,
  replacedLinks,
  truncateLabel,
  type GraphNode,
} from '@/lib/graph-model';
import type { TemporalFact } from '@/lib/api-client';
import { Badge, Button } from '@/components/ui';

const LIST_BUTTON =
  'w-full rounded-[var(--radius-control)] px-1.5 py-1 text-left hover:bg-surface-2 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
const LINK_BUTTON =
  'text-left text-[12px] text-ink underline-offset-2 hover:text-accent hover:underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
const SECTION_TITLE = 'text-[11px] font-semibold text-muted';

function formatDate(value: string | undefined): string {
  if (!value) return 'present';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export interface NodePanelProps {
  node: GraphNode | null;
  facts: TemporalFact[];
  relatedEntity: string | null;
  relatedLoading: boolean;
  relatedDisabled: boolean;
  relatedDisabledReason: string | null;
  status: string | null;
  onLoadRelated: () => void;
  onSelectNode: (id: string) => void;
  onSelectFact: (factId: string) => void;
  onClear: () => void;
}

/** Details for the selected node: entity mentions or a full fact record. */
export function NodePanel({
  node,
  facts,
  relatedEntity,
  relatedLoading,
  relatedDisabled,
  relatedDisabledReason,
  status,
  onLoadRelated,
  onSelectNode,
  onSelectFact,
  onClear,
}: NodePanelProps) {
  const entity = node?.type === 'entity' ? (node.entity ?? node.label) : null;
  const fact = node?.type === 'fact' && node.factId ? (facts.find((item) => item.id === node.factId) ?? null) : null;

  const mentions = useMemo(
    () => (entity ? entityMentions(facts, entity) : []),
    [facts, entity],
  );
  const coOccurring = useMemo(
    () => (entity ? oftenAppearsWith(facts, entity, 6) : []),
    [facts, entity],
  );
  const links = useMemo(
    () => (fact ? replacedLinks(facts, fact.id) : { replaces: [], replacedBy: null }),
    [facts, fact],
  );

  if (!node) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-ink">Click a node to inspect it.</p>
        <p className="text-[12px] text-muted">
          Blue nodes are entities; green nodes are facts, and a dashed fact is superseded.
        </p>
        <p className="text-[12px] text-muted">
          An edge means two entities share a fact in Entities mode; in Facts &amp; entities
          mode it means a fact mentions an entity or replaces another fact.
        </p>
      </div>
    );
  }

  const relatedBlock = (
    <div className="space-y-1 border-t border-line pt-3">
      <Button
        variant="primary"
        size="sm"
        className="w-full"
        onClick={onLoadRelated}
        loading={relatedLoading}
        disabled={relatedDisabled}
      >
        Show related facts
      </Button>
      {relatedEntity ? (
        <p className="text-[11px] text-muted">
          Loads more facts that mention «{relatedEntity}».
        </p>
      ) : null}
      {relatedDisabledReason && !status ? (
        <p className="text-[11px] text-muted">{relatedDisabledReason}</p>
      ) : null}
      <p role="status" className="min-h-[1em] text-[11px] text-ink">
        {status ?? ''}
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {node.type === 'entity' ? (
            <Badge>Entity</Badge>
          ) : (
            <>
              <Badge tone="done">Fact</Badge>
              {node.state === 'superseded' ? <Badge>Superseded</Badge> : null}
            </>
          )}
          <span className="text-[11px] text-muted">Direct links: {node.degree}</span>
        </div>
        <Button size="sm" variant="ghost" aria-label="Clear node selection" onClick={onClear}>
          ×
        </Button>
      </div>

      {node.type === 'entity' ? (
        <>
          <h3 className="break-words text-[14px] font-semibold text-ink">{node.label}</h3>

          <div className="space-y-1">
            <p className="text-[12px] text-muted">
              Mentioned in {mentions.length} {mentions.length === 1 ? 'fact' : 'facts'}
            </p>
            {mentions.length === 0 ? (
              <p className="text-[12px] text-muted">Not mentioned in any loaded fact.</p>
            ) : (
              <ul className="space-y-0.5">
                {mentions.map((item) => (
                  <li key={item.id}>
                    <button type="button" className={LIST_BUTTON} onClick={() => onSelectFact(item.id)}>
                      <span className="block text-[12px] text-ink">
                        {truncateLabel(item.statement, 64)}
                      </span>
                      <span className="block text-[11px] text-muted">{item.category}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1">
            <h4 className={SECTION_TITLE}>Often appears with</h4>
            {coOccurring.length === 0 ? (
              <p className="text-[12px] text-muted">No co-occurring entities.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {coOccurring.map((row) => (
                  <button
                    key={row.entity}
                    type="button"
                    onClick={() => onSelectNode(entityNodeId(row.entity))}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <span>{row.entity}</span>
                    <span className="text-muted">
                      · {row.shared} shared {row.shared === 1 ? 'fact' : 'facts'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {relatedBlock}
        </>
      ) : (
        <>
          <p className="text-[12px] leading-relaxed text-ink">
            {fact ? fact.statement : node.label}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {fact ? <Badge>{fact.category}</Badge> : null}
            {fact ? <span className="text-[11px] text-muted">Confidence: {fact.confidence}</span> : null}
          </div>

          {fact ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted">Valid from</dt>
              <dd className="text-ink">{formatDate(fact.validFrom)}</dd>
              <dt className="text-muted">Valid to</dt>
              <dd className="text-ink">{formatDate(fact.validTo)}</dd>
            </dl>
          ) : null}

          {fact && fact.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {fact.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          ) : null}

          {links.replaces.length > 0 ? (
            <div className="space-y-1">
              <h4 className={SECTION_TITLE}>Replaces</h4>
              <ul className="space-y-0.5">
                {links.replaces.map((id) => (
                  <li key={id}>
                    <button type="button" className={LINK_BUTTON} onClick={() => onSelectFact(id)}>
                      {truncateLabel(facts.find((item) => item.id === id)?.statement ?? id, 64)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {links.replacedBy ? (
            <div className="space-y-1">
              <h4 className={SECTION_TITLE}>Replaced by</h4>
              <button type="button" className={LINK_BUTTON} onClick={() => onSelectFact(links.replacedBy as string)}>
                {truncateLabel(
                  facts.find((item) => item.id === links.replacedBy)?.statement ?? links.replacedBy,
                  64,
                )}
              </button>
            </div>
          ) : null}

          {fact && fact.entities.length > 0 ? (
            <div className="space-y-1">
              <h4 className={SECTION_TITLE}>Entities</h4>
              <div className="flex flex-wrap gap-1">
                {fact.entities.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onSelectNode(entityNodeId(name))}
                    className="rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <Badge>{name}</Badge>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {relatedBlock}
        </>
      )}
    </div>
  );
}
