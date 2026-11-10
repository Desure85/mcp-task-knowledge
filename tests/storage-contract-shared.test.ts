/**
 * Gate §5.2 этапа Y — один и тот же контрактный набор на трёх профилях.
 *
 * Набор намеренно не зависит от раскладки файлов и таблиц: он проверяет публичный контракт
 * ADR-009 (задачи/документы/проекты/история/события/замки), поэтому file, sqlite и postgres
 * прогоняются одним и тем же кодом. Postgres-часть включается `POSTGRES_URL` (в CI — реальный
 * сервис, локально — embedded PostgreSQL); без переменной она документированно skip.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DATA_DIR } from '../src/config.js';
import { createFileProfile } from '../src/storage/profiles/file/index.js';
import { createSqliteProfile } from '../src/storage/profiles/sqlite/index.js';
import { createPostgresProfile } from '../src/storage/profiles/postgres/index.js';
import type { StorageProfile } from '../src/storage/contracts.js';

interface ProfileFixture {
  profile: StorageProfile;
  cleanup(): Promise<void>;
}

type ProfileFactory = () => Promise<ProfileFixture>;

let runCounter = 0;
function projectId(): string {
  runCounter += 1;
  return `shared-${Date.now().toString(36)}-${runCounter}`;
}

function runSharedContract(label: string, expectedProfile: string, create: ProfileFactory): void {
  describe(`shared storage contract: ${label}`, () => {
    it('publishes an honest manifest with the mandatory collections', async () => {
      const { profile, cleanup } = await create();
      try {
        expect(profile.manifest.profile).toBe(expectedProfile);
        for (const collection of ['tasks', 'docs', 'projects', 'history', 'events', 'locks']) {
          expect(profile.manifest.collections).toContain(collection);
        }
        expect(typeof profile.manifest.capabilities.transactions).toBe('boolean');
      } finally {
        await cleanup();
      }
    });

    it('implements the task lifecycle and paging', async () => {
      const { profile, cleanup } = await create();
      const project = projectId();
      try {
        await profile.project.create(project, 'shared contract project');
        const created = await profile.tasks.create({ project, title: 'shared task', description: 'body' });
        expect((await profile.tasks.get(project, created.id))?.title).toBe('shared task');

        const updated = await profile.tasks.update(project, created.id, { title: 'renamed', priority: 'high' });
        expect(updated).toMatchObject({ title: 'renamed', priority: 'high' });

        expect((await profile.tasks.close(project, created.id))?.status).toBe('closed');
        const archived = await profile.tasks.archive(project, created.id);
        expect(archived?.archived).toBe(true);
        const restored = await profile.tasks.restore(project, created.id);
        expect(restored?.archived ?? false).toBe(false);

        for (let index = 0; index < 3; index += 1) {
          await profile.tasks.create({ project, title: `page ${index}` });
        }
        const page = await profile.tasks.page(project, { limit: 2 });
        expect(page.items.length).toBe(2);
        expect(page.keys.length).toBe(2);
        expect(page.total).toBeGreaterThanOrEqual(4);
        expect(page.hasMore).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it('implements documents, versions and history uniformly', async () => {
      const { profile, cleanup } = await create();
      const project = projectId();
      try {
        await profile.project.create(project, 'shared docs project');
        const doc = await profile.docs.create({ project, title: 'shared doc', content: 'v1', tags: ['a'] });
        expect((await profile.docs.read(project, doc.id))?.content).toBe('v1');
        const updated = await profile.docs.update(project, doc.id, { content: 'v2' });
        expect(updated?.content).toBe('v2');

        const versions = await profile.docs.versions(project, doc.id);
        expect(versions.length).toBeGreaterThanOrEqual(1);
        expect((await profile.history.list(project, 'doc', doc.id)).length).toBeGreaterThanOrEqual(1);

        const restored = await profile.history.restore(project, 'doc', doc.id, versions[0].version);
        expect(restored).not.toBeNull();

        expect((await profile.docs.archive(project, doc.id))?.archived).toBe(true);
        expect((await profile.docs.restore(project, doc.id))?.archived ?? false).toBe(false);
        expect((await profile.docs.list({ project, includeArchived: true })).some((entry) => entry.id === doc.id)).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it('implements project metadata behind the contract', async () => {
      const { profile, cleanup } = await create();
      const project = projectId();
      try {
        const created = await profile.project.create(project, 'shared project');
        expect(created.id).toBe(project);
        expect((await profile.project.list(() => project)).some((entry) => entry.id === project)).toBe(true);

        const metadata = await profile.project.updateMetadata(project, { description: 'metadata updated' });
        expect(metadata?.description).toBe('metadata updated');
        expect((await profile.project.readMetadata(project))?.description).toBe('metadata updated');
        expect(await profile.project.detail(project, () => project)).not.toBeNull();
      } finally {
        await cleanup();
      }
    });

    it('serializes critical sections through the lock provider', async () => {
      const { profile, cleanup } = await create();
      const project = projectId();
      try {
        await profile.project.create(project, 'shared locks project');
        let counter = 0;
        let maxInside = 0;
        let inside = 0;
        const work = async (): Promise<void> => {
          inside += 1;
          maxInside = Math.max(maxInside, inside);
          counter += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          inside -= 1;
        };
        await Promise.all([
          profile.locks.withLock(`${project}:critical`, work),
          profile.locks.withLock(`${project}:critical`, work),
          profile.locks.withLock(`${project}:critical`, work),
        ]);
        expect(counter).toBe(3);
        expect(maxInside).toBe(1);
      } finally {
        await cleanup();
      }
    });

    it('appends and reads event-log entries per factory path', async () => {
      const { profile, cleanup } = await create();
      const logPath = path.join(DATA_DIR, '.index', `shared-events-${Date.now().toString(36)}.jsonl`);
      try {
        const log = profile.events(logPath);
        const first = log.append('entity-1', 'task', 'create', { title: 'one' }, 1);
        log.append('entity-1', 'task', 'update', { title: 'two' }, 2);
        const since = log.since(first.eventId);
        expect(since.length).toBeGreaterThanOrEqual(1);
        log.compact();
        expect(log.snapshot('entity-1')?.state).toMatchObject({ title: 'two' });
        expect(log.snapshots().some((snapshot) => snapshot.entityId === 'entity-1')).toBe(true);
      } finally {
        await cleanup();
        await fsp.rm(logPath, { force: true });
      }
    });
  });
}

runSharedContract('file', 'file', async () => {
  const profile = createFileProfile();
  return {
    profile,
    cleanup: async () => {
      // The suite uses a unique project per run; file cleanup removes that project's directories.
      const projects = await profile.project.list(() => '');
      for (const entry of projects) {
        if (entry.id.startsWith('shared-')) await profile.project.remove(entry.id, true).catch(() => undefined);
      }
    },
  };
});

runSharedContract('sqlite', 'sqlite', async () => {
  const databasePath = path.join(DATA_DIR, '.index', `shared-contract-${Date.now().toString(36)}.sqlite`);
  const profile = createSqliteProfile({ databasePath });
  return {
    profile,
    cleanup: async () => {
      await profile.project.list(() => '').then(async (projects) => {
        for (const entry of projects) {
          if (entry.id.startsWith('shared-')) await profile.project.remove(entry.id, true).catch(() => undefined);
        }
      });
      profile.close?.();
      await fsp.rm(databasePath, { force: true });
      await fsp.rm(`${databasePath}-wal`, { force: true });
      await fsp.rm(`${databasePath}-shm`, { force: true });
    },
  };
});

const postgresUrl = process.env.POSTGRES_URL;
if (postgresUrl) {
  runSharedContract('postgres', 'postgres', async () => {
    const profile = await createPostgresProfile({ connectionString: postgresUrl });
    return {
      profile,
      cleanup: async () => {
        for (const entry of await profile.project.list(() => '')) {
          if (entry.id.startsWith('shared-')) await profile.project.remove(entry.id, true).catch(() => undefined);
        }
        profile.close?.();
      },
    };
  });
} else {
  describe.skip('shared storage contract: postgres (requires POSTGRES_URL)', () => {
    it('runs the same suite when POSTGRES_URL is set (CI service or embedded PostgreSQL)', () => {
      // Documented skip: file and sqlite instances above still prove the shared runner executes.
    });
  });
}
