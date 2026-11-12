/** MU-03: process-wide history service. Disabled in tests and when HISTORY_ENABLED=0. */
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { currentSessionId } from '../core/request-context.js';
import { GitHistory } from './git.js';

let instance: GitHistory | undefined;

export function historyEnabled(): boolean {
  return process.env.HISTORY_ENABLED === '1' && process.env.NODE_ENV !== 'test';
}

export function historyAuthor(): string {
  const session = currentSessionId();
  if (session) return `${session} <${session}@session>`;
  return 'mcp-task-knowledge <mcp@localhost>';
}

export function history(): GitHistory {
  if (!instance) {
    instance = new GitHistory({ root: DATA_DIR, author: historyAuthor() });
  }
  return instance;
}

export async function initHistory(): Promise<void> {
  if (!historyEnabled()) return;
  await history().init();
}

export async function enqueueHistory(paths: string[]): Promise<void> {
  if (!historyEnabled()) return;
  history().setAuthor(historyAuthor());
  await history().enqueue(paths.map((p) => path.relative(DATA_DIR, p)));
}

export async function closeHistory(): Promise<void> {
  if (!instance) return;
  await instance.close();
  instance = undefined;
}
