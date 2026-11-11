export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
  hint?: string;
}

/** All ids in depth-first order (used by callers that need branch counts). */
export function treeIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...treeIds(node.children ?? [])]);
}

/** Descendant count for a "3 of 5" progress label; direct child count is a subset. */
export function descendantCount(node: TreeNode): number {
  return (node.children ?? []).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

/** Visible nodes in render order, respecting the expanded set. */
export function visibleTree(
  nodes: TreeNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): Array<{ node: TreeNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(expanded.has(node.id) ? visibleTree(node.children ?? [], expanded, depth + 1) : []),
  ]);
}
