/**
 * Y-02 — file profile behind the storage contracts.
 *
 * The file profile is today's behaviour: tasks are JSON files under `TASKS_DIR`, knowledge is
 * markdown with frontmatter under `KNOWLEDGE_DIR`, history lives in `.versions`, and the derived
 * indexes (metadata + FTS5) keep their own schemas. This module adds no logic: every method
 * delegates to the function that the tools call today, so the contract tests can compare the two
 * paths and expect identical results.
 *
 * The caller passes the roots (ADR-009 rule 1: the interface does not know `DATA_DIR`). Until the
 * storage modules accept roots as parameters — that is Y-02c, together with switching call sites
 * over — the file profile verifies that the root it was given is the one the modules actually use
 * and refuses to work otherwise (`CONFIG_MISMATCH`), instead of silently serving another directory.
 */

import { KNOWLEDGE_DIR, TASKS_DIR } from '../../../config.js';
import {
  archiveTask,
  claimTask,
  closeTask,
  createTask,
  deleteTaskPermanent,
  getTask,
  listTasks,
  listTasksPage,
  listTasksTree,
  releaseTaskClaim,
  renewTaskClaim,
  restoreTask,
  trashTask,
  updateTask,
} from '../../tasks.js';
import {
  archiveDoc,
  createDoc,
  deleteDocPermanent,
  listDocVersions,
  listDocs,
  listDocsPage,
  readDoc,
  restoreDoc,
  restoreDocVersion,
  trashDoc,
  updateDoc,
} from '../../knowledge.js';
import { resolveStoreId } from '../../../search/fts-index.js';
import {
  StoreError,
  type CreateDocInput,
  type CreateTaskInput,
  type DocListFilter,
  type DocPageOptions,
  type DocPatch,
  type DocStore,
  type DocVersionInfo,
  type StorageProfile,
  type StoreManifest,
  type TaskListFilter,
  type TaskPageOptions,
  type TaskPatch,
  type TaskStore,
} from '../../contracts.js';

export interface FileProfileOptions {
  /** Root of the tasks collection; defaults to the configured `TASKS_DIR`. */
  tasksDir?: string;
  /** Root of the knowledge collection; defaults to the configured `KNOWLEDGE_DIR`. */
  knowledgeDir?: string;
}

/** Refuse to serve a root the storage modules do not actually use. */
function assertRootMatchesConfig(label: 'tasks' | 'knowledge', requested: string | undefined, configured: string): string {
  const configuredId = resolveStoreId(configured);
  if (requested === undefined) return configuredId;
  const requestedId = resolveStoreId(requested);
  if (requestedId !== configuredId) {
    throw new StoreError(
      'CONFIG_MISMATCH',
      `File profile ${label} root does not match the configured directory`,
      { label, requested: requestedId, configured: configuredId },
    );
  }
  return requestedId;
}

class FileTaskStore implements TaskStore {
  list(filter?: TaskListFilter) {
    return listTasks(filter);
  }

  page(project: string, options: TaskPageOptions) {
    return listTasksPage(project, options);
  }

  get(project: string, id: string) {
    return getTask(project, id);
  }

  create(input: CreateTaskInput) {
    return createTask(input);
  }

  update(project: string, id: string, patch: TaskPatch) {
    return updateTask(project, id, patch);
  }

  close(project: string, id: string) {
    return closeTask(project, id);
  }

  archive(project: string, id: string) {
    return archiveTask(project, id);
  }

  trash(project: string, id: string) {
    return trashTask(project, id);
  }

  restore(project: string, id: string) {
    return restoreTask(project, id);
  }

  deletePermanent(project: string, id: string) {
    return deleteTaskPermanent(project, id);
  }

  tree(filter?: TaskListFilter) {
    return listTasksTree(filter);
  }

  claim(project: string, id: string, actor: Parameters<TaskStore['claim']>[2]) {
    return claimTask(project, id, actor);
  }

  renewClaim(project: string, id: string, actor: Parameters<TaskStore['renewClaim']>[2]) {
    return renewTaskClaim(project, id, actor);
  }

  releaseClaim(project: string, id: string, actor: Parameters<TaskStore['releaseClaim']>[2]) {
    return releaseTaskClaim(project, id, actor);
  }
}

class FileDocStore implements DocStore {
  list(filter?: DocListFilter) {
    return listDocs(filter);
  }

  page(project: string, options: DocPageOptions) {
    return listDocsPage(project, options);
  }

  read(project: string, id: string) {
    return readDoc(project, id);
  }

  create(input: CreateDocInput) {
    return createDoc(input);
  }

  update(project: string, id: string, patch: DocPatch) {
    return updateDoc(project, id, patch);
  }

  archive(project: string, id: string) {
    return archiveDoc(project, id);
  }

  trash(project: string, id: string) {
    return trashDoc(project, id);
  }

  restore(project: string, id: string) {
    return restoreDoc(project, id);
  }

  deletePermanent(project: string, id: string) {
    return deleteDocPermanent(project, id);
  }

  async versions(project: string, id: string): Promise<DocVersionInfo[]> {
    return listDocVersions(project, id);
  }

  restoreVersion(project: string, id: string, version: number) {
    return restoreDocVersion(project, id, version);
  }
}

/** Build the file profile (files and git) behind the storage contracts. */
export function createFileProfile(options: FileProfileOptions = {}): StorageProfile {
  const roots = {
    tasks: assertRootMatchesConfig('tasks', options.tasksDir, TASKS_DIR),
    knowledge: assertRootMatchesConfig('knowledge', options.knowledgeDir, KNOWLEDGE_DIR),
  };

  const manifest: StoreManifest = {
    profile: 'file',
    // Files and git: no multi-record transactions; versions are `.versions` snapshots; the
    // derived FTS5 index provides full-text; vectors live in the on-disk cache; the metadata
    // index provides pages and counts without reading content (SC-02/SC-03).
    capabilities: {
      transactions: false,
      history: true,
      fullText: true,
      vectors: true,
      efficientListing: true,
    },
    roots,
    collections: ['tasks', 'docs'],
  };

  return {
    manifest,
    tasks: new FileTaskStore(),
    docs: new FileDocStore(),
  };
}
