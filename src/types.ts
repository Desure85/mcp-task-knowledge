export type Priority = 'low' | 'medium' | 'high';
export type Status = 'pending' | 'in_progress' | 'completed' | 'closed';

export interface Task {
  id: string;
  project: string; // namespace/key for project
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  tags?: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  links?: string[]; // file paths or URLs
  // Optional parent task ID to support hierarchical task trees
  parentId?: string;
  // Soft-delete lifecycle
  archived?: boolean;
  trashed?: boolean;
  archivedAt?: string; // ISO
  trashedAt?: string; // ISO
}

export interface KnowledgeDocMeta {
  id: string;
  project: string;
  title: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  source?: string; // optional source path/url
  // Optional hierarchical fields for knowledge tree
  parentId?: string; // parent knowledge doc id
  type?: string; // e.g. component, api, schemas, routes, overview
  // Soft-delete lifecycle
  archived?: boolean;
  trashed?: boolean;
  archivedAt?: string; // ISO
  trashedAt?: string; // ISO
}

export interface KnowledgeDoc extends KnowledgeDocMeta {
  content: string; // markdown
}

export interface SearchResult<T = any> {
  id: string;
  score: number;
  item: T;
  path?: string;
}

// Recursive node type for representing task trees
export interface TaskTreeNode extends Task {
  children: TaskTreeNode[];
}
