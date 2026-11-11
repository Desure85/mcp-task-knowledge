import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TreeView } from './TreeView';
import { descendantCount, treeIds, type TreeNode } from '@/lib/tree';

const tree: TreeNode[] = [
  {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'child-a', label: 'Child A' },
      { id: 'child-b', label: 'Child B', children: [{ id: 'grand', label: 'Grand' }] },
    ],
  },
  { id: 'solo', label: 'Solo' },
];

describe('tree helpers', () => {
  it('collects ids and counts descendants depth-first', () => {
    expect(treeIds(tree)).toEqual(['root', 'child-a', 'child-b', 'grand', 'solo']);
    expect(descendantCount(tree[0])).toBe(3);
    expect(descendantCount(tree[1])).toBe(0);
  });
});

describe('TreeView', () => {
  it('renders nested groups and aria-expanded state', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={tree} ariaLabel="Demo tree" defaultExpandedIds={['root', 'child-b']} onSelect={() => undefined} />,
    );
    expect(html).toContain('role="tree"');
    expect(html).toContain('aria-label="Demo tree"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="group"');
    expect(html).toContain('Child A');
    expect(html).toContain('Grand');
  });

  it('keeps collapsed children out of the rendered tree', () => {
    const html = renderToStaticMarkup(
      <TreeView nodes={tree} ariaLabel="Demo tree" defaultExpandedIds={[]} onSelect={() => undefined} />,
    );
    expect(html).toContain('Root');
    expect(html).not.toContain('Child A');
    expect(html).toContain('Solo');
  });
});
