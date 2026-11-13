/** INT-008 mock tracker: a JSON file that behaves like a minimal external issue tracker. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ExternalTask, TrackerAdapter } from './types.js';

interface TrackerFile {
  nextId: number;
  issues: ExternalTask[];
}

export class FileTrackerAdapter implements TrackerAdapter {
  readonly system = 'file' as const;

  constructor(private readonly file: string, private readonly clock: () => string = () => new Date().toISOString()) {}

  private async load(): Promise<TrackerFile> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as TrackerFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { nextId: 1, issues: [] };
      throw error;
    }
  }

  private async save(state: TrackerFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  async list(_project: string): Promise<ExternalTask[]> {
    return (await this.load()).issues;
  }

  async create(input: ExternalTask): Promise<ExternalTask> {
    const state = await this.load();
    const issue: ExternalTask = {
      ...input,
      id: input.id || `FILE-${state.nextId++}`,
      updatedAt: this.clock(),
    };
    state.issues.push(issue);
    await this.save(state);
    return issue;
  }

  async update(id: string, patch: Partial<Omit<ExternalTask, 'id' | 'updatedAt'>>): Promise<ExternalTask> {
    const state = await this.load();
    const index = state.issues.findIndex((issue) => issue.id === id);
    if (index < 0) throw new Error(`external issue not found: ${id}`);
    const next: ExternalTask = { ...state.issues[index], ...patch, id, updatedAt: this.clock() };
    state.issues[index] = next;
    await this.save(state);
    return next;
  }
}
