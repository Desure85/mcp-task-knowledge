/** INT-008: canonical types shared by the sync engine and tracker adapters. */
import type { Priority, Task } from '../types.js';

export interface ExternalTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  tags?: string[];
  assignee?: string;
  updatedAt: string;
  url?: string;
}

export interface TrackerAdapter {
  readonly system: 'youtrack' | 'jira' | 'linear' | 'file';
  list(project: string): Promise<ExternalTask[]>;
  create(input: ExternalTask): Promise<ExternalTask>;
  update(id: string, patch: Partial<Omit<ExternalTask, 'id' | 'updatedAt'>>): Promise<ExternalTask>;
}

export interface SyncTaskStore {
  list(project: string): Promise<Task[]>;
  create(input: {
    project: string;
    title: string;
    description?: string;
    status: string;
    priority?: Priority;
    tags?: string[];
    assignee?: string;
    external?: Task['external'];
  }): Promise<Task>;
  update(project: string, id: string, patch: Partial<Task>, expectedVersion?: number): Promise<Task | null>;
}

export interface SyncConflict {
  taskId: string;
  externalId: string;
  fields: string[];
}

export interface SyncResult {
  dryRun: boolean;
  createdLocal: string[];
  updatedLocal: string[];
  createdExternal: string[];
  updatedExternal: string[];
  skipped: string[];
  conflicts: SyncConflict[];
  errors: Array<{ taskId?: string; externalId?: string; message: string }>;
}
