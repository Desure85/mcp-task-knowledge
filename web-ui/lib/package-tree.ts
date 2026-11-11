import type { TreeNode } from './tree';

interface PackageFileLike {
  path: string;
  size?: number;
}

interface Directory {
  children: Map<string, Directory>;
  file?: PackageFileLike;
}

function directory(): Directory {
  return { children: new Map() };
}

function labelOf(segment: string): string {
  return segment;
}

/** Build a nested TreeView model from flat POSIX package paths. */
export function packageTreeNodes(files: PackageFileLike[]): TreeNode[] {
  const root = directory();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      let next = current.children.get(part);
      if (!next) {
        next = directory();
        current.children.set(part, next);
      }
      if (index === parts.length - 1) next.file = file;
      current = next;
    });
  }

  const convert = (node: Directory): TreeNode[] =>
    [...node.children.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => ({
        id: child.file ? child.file.path : `${name}/`,
        label: labelOf(name),
        hint: child.file?.size !== undefined ? `${child.file.size} B` : undefined,
        children: convert(child),
      }));

  return convert(root);
}

