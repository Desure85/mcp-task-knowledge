import { DEFAULT_PROJECT, TASKS_DIR, KNOWLEDGE_DIR, DATA_DIR } from './config.js';
import type { Task } from './types.js';

export type ProjectInfo = {
  id: string;
  isDefault: boolean;
  isCurrent: boolean;
  paths: { tasks: string; knowledge: string };
  hasTasks: boolean;
  hasKnowledge: boolean;
  taskCount: number;
  knowledgeCount: number;
  description?: string;
  createdAt?: string;
};

export type ProjectDetail = ProjectInfo & {
  taskStats: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    recent: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  };
  knowledgeStats: {
    total: number;
    byType: Record<string, number>;
    recent: Array<{ id: string; title: string; updatedAt: string }>;
  };
  metadata?: ProjectMetadata;
};

export interface ProjectMetadata {
  description?: string;
  createdAt: string;
  updatedAt: string;
}

const PROJECT_META_FILE = '.project.json';

export async function listProjects(getCurrent: () => string): Promise<{ current: string; default: string; count: number; projects: ProjectInfo[] }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  async function listDirs(base: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(base, { withFileTypes: true } as any);
      return entries.filter((e: any) => e.isDirectory()).map((e: any) => e.name);
    } catch {
      return [];
    }
  }

  async function countFiles(dir: string, exts: string[]): Promise<number> {
    try {
      const files = await fs.readdir(dir);
      return files.filter(f => exts.some(e => f.endsWith(e))).length;
    } catch {
      return 0;
    }
  }

  const fromTasks = await listDirs(TASKS_DIR);
  const fromKnowledge = await listDirs(KNOWLEDGE_DIR);
  const set = new Set<string>([...fromTasks, ...fromKnowledge]);
  if (set.size === 0) set.add(DEFAULT_PROJECT);
  const cur = getCurrent();
  const projects: ProjectInfo[] = [];

  for (const id of Array.from(set).sort()) {
    const taskDir = path.join(TASKS_DIR, id);
    const knowledgeDir = path.join(KNOWLEDGE_DIR, id);

    // Read metadata if exists
    let description: string | undefined;
    let createdAt: string | undefined;
    try {
      const meta = await readProjectMetadata(id);
      description = meta?.description;
      createdAt = meta?.createdAt;
    } catch {}

    projects.push({
      id,
      isDefault: id === DEFAULT_PROJECT,
      isCurrent: id === cur,
      paths: { tasks: taskDir, knowledge: knowledgeDir },
      hasTasks: fromTasks.includes(id),
      hasKnowledge: fromKnowledge.includes(id),
      taskCount: await countFiles(taskDir, ['.json']),
      knowledgeCount: await countFiles(knowledgeDir, ['.md', '.markdown']),
      description,
      createdAt,
    });
  }

  return { current: cur, default: DEFAULT_PROJECT, count: projects.length, projects };
}

export async function getProjectDetail(projectId: string, getCurrent: () => string): Promise<ProjectDetail | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { listTasks } = await import('./storage/tasks.js');
  const { listDocs } = await import('./storage/knowledge.js');

  // Verify project exists
  const taskDir = path.join(TASKS_DIR, projectId);
  const knowledgeDir = path.join(KNOWLEDGE_DIR, projectId);
  const hasTasks = await dirExists(taskDir);
  const hasKnowledge = await dirExists(knowledgeDir);

  if (!hasTasks && !hasKnowledge) return null;

  // Gather stats
  const tasks = await listTasks({ project: projectId, includeArchived: false, includeTrashed: false });
  const docs = await listDocs({ project: projectId, includeArchived: false, includeTrashed: false });

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
  }

  const byType: Record<string, number> = {};
  for (const d of docs) {
    const type = (d as any).type || 'general';
    byType[type] = (byType[type] || 0) + 1;
  }

  let metadata: ProjectMetadata | undefined;
  try { metadata = await readProjectMetadata(projectId) ?? undefined; } catch {}

  return {
    id: projectId,
    isDefault: projectId === DEFAULT_PROJECT,
    isCurrent: projectId === getCurrent(),
    paths: { tasks: taskDir, knowledge: knowledgeDir },
    hasTasks,
    hasKnowledge,
    taskCount: tasks.length,
    knowledgeCount: docs.length,
    description: metadata?.description,
    createdAt: metadata?.createdAt,
    taskStats: {
      total: tasks.length,
      byStatus,
      byPriority,
      recent: tasks.slice(0, 5).map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        updatedAt: t.updatedAt,
      })),
    },
    knowledgeStats: {
      total: docs.length,
      byType,
      recent: docs.slice(0, 5).map(d => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
      })),
    },
    metadata,
  };
}

export async function createProject(projectId: string, description?: string): Promise<ProjectInfo> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const taskDir = path.join(TASKS_DIR, projectId);
  const knowledgeDir = path.join(KNOWLEDGE_DIR, projectId);

  await fs.mkdir(taskDir, { recursive: true });
  await fs.mkdir(knowledgeDir, { recursive: true });

  // Write metadata
  const meta: ProjectMetadata = {
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeProjectMetadata(projectId, meta);

  return {
    id: projectId,
    isDefault: projectId === DEFAULT_PROJECT,
    isCurrent: false,
    paths: { tasks: taskDir, knowledge: knowledgeDir },
    hasTasks: false,
    hasKnowledge: false,
    taskCount: 0,
    knowledgeCount: 0,
    description,
    createdAt: meta.createdAt,
  };
}

export async function deleteProject(projectId: string, force: boolean): Promise<{ deleted: boolean; message: string }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  if (projectId === DEFAULT_PROJECT) {
    return { deleted: false, message: 'Cannot delete the default project' };
  }

  const taskDir = path.join(TASKS_DIR, projectId);
  const knowledgeDir = path.join(KNOWLEDGE_DIR, projectId);

  // Check if project has data
  const taskFiles = await countJsonFiles(taskDir);
  const knowledgeFiles = await countJsonFiles(knowledgeDir);
  const hasData = taskFiles > 0 || knowledgeFiles > 0;

  if (hasData && !force) {
    return {
      deleted: false,
      message: `Project has data (${taskFiles} tasks, ${knowledgeFiles} knowledge entries). Use force=true to delete.`,
    };
  }

  // Delete directories
  let deleted = false;
  try {
    await fs.rm(taskDir, { recursive: true, force: true });
    await fs.rm(knowledgeDir, { recursive: true, force: true });
    deleted = true;

    // Clean up metadata
    const metaPath = path.join(DATA_DIR, 'projects', `${projectId}.json`);
    try { await fs.unlink(metaPath); } catch {}
  } catch (e: any) {
    return { deleted: false, message: `Failed to delete: ${e.message}` };
  }

  return { deleted, message: deleted ? `Project '${projectId}' deleted` : `Project '${projectId}' not found` };
}

export async function updateProjectMeta(projectId: string, updates: { description?: string }): Promise<ProjectMetadata | null> {
  const existing = await readProjectMetadata(projectId);
  const meta: ProjectMetadata = {
    description: updates.description ?? existing?.description,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeProjectMetadata(projectId, meta);
  return meta;
}

// ── Internal helpers ──────────────────────────────────────

async function dirExists(p: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  const fs = await import('node:fs/promises');
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function getProjectMetaPath(projectId: string): Promise<string> {
  const path = await import('node:path');
  const metaDir = path.join(DATA_DIR, 'projects');
  return path.join(metaDir, `${projectId}.json`);
}

export async function readProjectMetadata(projectId: string): Promise<ProjectMetadata | null> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const metaPath = await getProjectMetaPath(projectId);
  try {
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeProjectMetadata(projectId: string, meta: ProjectMetadata): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const metaPath = await getProjectMetaPath(projectId);
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}
