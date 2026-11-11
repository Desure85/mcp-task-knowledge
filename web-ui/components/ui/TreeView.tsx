'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { IconChevronRight } from '@/components/icons';
import type { TreeNode } from '@/lib/tree';

export interface TreeViewProps {
  nodes: TreeNode[];
  ariaLabel: string;
  onSelect: (node: TreeNode) => void;
  selectedId?: string | null;
  defaultExpandedIds?: string[];
  loadingIds?: ReadonlySet<string>;
  onExpand?: (node: TreeNode, open: boolean) => void;
  className?: string;
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  selectedId?: string | null;
  loadingIds?: ReadonlySet<string>;
  onToggle: (node: TreeNode) => void;
  onSelect: (node: TreeNode) => void;
}

function TreeItem({ node, depth, expanded, selectedId, loadingIds, onToggle, onSelect }: TreeItemProps) {
  const children = node.children ?? [];
  const hasChildren = node.hasChildren ?? children.length > 0;
  const open = expanded.has(node.id);
  const selected = selectedId === node.id;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={selected}>
      <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
            onClick={() => onToggle(node)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-ink"
          >
            <IconChevronRight className={cn('h-3.5 w-3.5 transition', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="h-6 w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'min-w-0 flex-1 truncate rounded-[var(--radius-control)] px-1.5 py-1 text-left hover:bg-surface-2',
            selected ? 'bg-surface-2 font-medium text-ink' : 'text-ink',
          )}
        >
          {node.label}
          {node.hint && <span className="ml-2 text-[11px] text-muted">{node.hint}</span>}
        </button>
      </div>
      {hasChildren && open && loadingIds?.has(node.id) && (
        <p role="status" className="pl-8 text-[11px] text-muted">Loading…</p>
      )}
      {hasChildren && open && !loadingIds?.has(node.id) && (
        <ul role="group" className="space-y-0.5">
          {children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              loadingIds={loadingIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Accessible tree: real nested groups, `aria-expanded` branches, one tab-stop. */
export function TreeView({
  nodes,
  ariaLabel,
  onSelect,
  selectedId,
  defaultExpandedIds,
  loadingIds,
  onExpand,
  className,
}: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedIds ?? []),
  );

  const toggle = (node: TreeNode) => {
    const open = !expanded.has(node.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    onExpand?.(node, open);
  };

  return (
    <ul role="tree" aria-label={ariaLabel} className={cn('space-y-0.5 text-[13px]', className)}>
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          selectedId={selectedId}
          loadingIds={loadingIds}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
