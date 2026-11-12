export interface BacklogRow {
  id: string;
  title: string;
  priority: string;
  statusRaw: string;
  status: string;
}

export interface TrackerTask {
  id: string;
  title: string;
  status: string;
  file: string;
}

export interface TrackerMismatch {
  backlogId: string;
  kind: 'missing-in-backlog' | 'missing-in-tracker' | 'status-mismatch';
  backlog: BacklogRow | null;
  tracker: TrackerTask | null;
}

export function canonicalStatus(raw: unknown): string;
export function parseBacklog(markdown: string): Map<string, BacklogRow>;
export function readTrackerTasks(dataDir: string, project: string): Promise<TrackerTask[]>;
export function reconcile(input: {
  backlog: Map<string, BacklogRow>;
  tasks: TrackerTask[];
  mapping: Record<string, { taskId?: string; taskTitle?: string }>;
}): { checked: number; mismatches: TrackerMismatch[] };
