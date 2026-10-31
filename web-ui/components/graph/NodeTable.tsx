'use client';

import { useEffect, useRef, useState } from 'react';
import { oftenAppearsWith, type GraphNode } from '@/lib/graph-model';
import type { TemporalFact } from '@/lib/api-client';
import { Badge, Card, CardBody } from '@/components/ui';

const ROW_BUTTON =
  'w-full text-left text-[12px] text-ink underline-offset-2 hover:text-accent hover:underline ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

/**
 * Accessible alternative to the SVG: the same nodes as a table. It is the
 * real keyboard path through the graph — one roving tab stop, arrow keys move
 * between rows, Enter (native button activation) selects.
 */
export function NodeTable({
  nodes,
  facts,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  facts: TemporalFact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (focusIndex > nodes.length - 1) setFocusIndex(Math.max(0, nodes.length - 1));
  }, [nodes.length, focusIndex]);

  useEffect(() => {
    const index = nodes.findIndex((node) => node.id === selectedId);
    if (index >= 0) setFocusIndex(index);
  }, [nodes, selectedId]);

  /** Entities: the two most frequent co-mentions; facts: their key entities. */
  function oftenWith(node: GraphNode): string {
    if (node.type === 'entity') {
      const rows = oftenAppearsWith(facts, node.entity ?? node.label, 2);
      return rows.length ? rows.map((row) => `${row.entity} (${row.shared})`).join(', ') : '—';
    }
    const fact = node.factId ? facts.find((item) => item.id === node.factId) : undefined;
    return fact && fact.entities.length ? fact.entities.slice(0, 3).join(', ') : '—';
  }

  function moveTo(index: number) {
    if (nodes.length === 0) return;
    const next = Math.max(0, Math.min(nodes.length - 1, index));
    setFocusIndex(next);
    buttons.current[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(nodes.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <Card>
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
          <caption className="px-3 pt-3 text-left text-[12px] font-semibold text-ink">
            Nodes
          </caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="px-3 py-1.5 font-medium">Node</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Type</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Facts</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Often with</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Direct links</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-[12px] text-muted">
                  No nodes match the search.
                </td>
              </tr>
            ) : (
              nodes.map((node, index) => {
                const selected = node.id === selectedId;
                return (
                  <tr
                    key={node.id}
                    aria-current={selected ? 'true' : undefined}
                    className={selected ? 'bg-surface-2' : undefined}
                  >
                    <td
                      className={`border-l-2 px-3 py-1.5 ${
                        selected ? 'border-accent' : 'border-transparent'
                      }`}
                    >
                      <button
                        ref={(element) => {
                          buttons.current[index] = element;
                        }}
                        type="button"
                        tabIndex={index === focusIndex ? 0 : -1}
                        onClick={() => onSelect(node.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={ROW_BUTTON}
                      >
                        {node.label}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={node.type === 'fact' ? 'done' : 'neutral'}>
                        {node.type === 'fact' ? 'Fact' : 'Entity'}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-muted">{node.factCount}</td>
                    <td className="px-3 py-1.5 text-muted">{oftenWith(node)}</td>
                    <td className="px-3 py-1.5 text-muted">{node.degree}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
