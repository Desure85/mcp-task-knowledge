import { DEFAULT_PROJECT } from './config.js';
import { TASKS_DIR, KNOWLEDGE_DIR } from './config.js';

export type ProjectInfo = {
  id: string;
  isDefault: boolean;
  isCurrent: boolean;
  paths: { tasks: string; knowledge: string };
  hasTasks: boolean;
  hasKnowledge: boolean;
};

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

  const fromTasks = await listDirs(TASKS_DIR);
  const fromKnowledge = await listDirs(KNOWLEDGE_DIR);
  const set = new Set<string>([...fromTasks, ...fromKnowledge]);
  if (set.size === 0) set.add(DEFAULT_PROJECT);
  const cur = getCurrent();
  const projects = Array.from(set)
    .sort()
    .map((id) => ({
      id,
      isDefault: id === DEFAULT_PROJECT,
      isCurrent: id === cur,
      paths: {
        tasks: path.join(TASKS_DIR, id),
        knowledge: path.join(KNOWLEDGE_DIR, id),
      },
      hasTasks: fromTasks.includes(id),
      hasKnowledge: fromKnowledge.includes(id),
    }));

  return { current: cur, default: DEFAULT_PROJECT, count: projects.length, projects };
}
