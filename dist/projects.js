import { DEFAULT_PROJECT } from './config.js';
import { TASKS_DIR, KNOWLEDGE_DIR } from './config.js';
export async function listProjects(getCurrent) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    async function listDirs(base) {
        try {
            const entries = await fs.readdir(base, { withFileTypes: true });
            return entries.filter((e) => e.isDirectory()).map((e) => e.name);
        }
        catch {
            return [];
        }
    }
    const fromTasks = await listDirs(TASKS_DIR);
    const fromKnowledge = await listDirs(KNOWLEDGE_DIR);
    const set = new Set([...fromTasks, ...fromKnowledge]);
    if (set.size === 0)
        set.add(DEFAULT_PROJECT);
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
