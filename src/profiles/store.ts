/**
 * UI-33a — small server-side per-user preferences store.
 *
 * The file lives under DATA_DIR and is written atomically. The API is
 * deliberately last-write-wins by `updatedAt`; an older write is returned as a
 * conflict with the current record so the client can retry with the merged
 * value. Equal timestamps with equal payloads are idempotent duplicates.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface UserProfile {
  userId: string;
  preferences: unknown;
  updatedAt: string;
  clientId?: string;
}

export interface ProfileWriteResult {
  applied: boolean;
  duplicate: boolean;
  conflict: boolean;
  profile: UserProfile | null;
}

export type ProfileErrorCode = 'INVALID_JSON' | 'TOO_LARGE' | 'INVALID_TIME';

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

const MAX_BYTES = 32 * 1024;

function assertPayload(preferences: unknown, updatedAt: string): void {
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
    throw new ProfileError('INVALID_TIME', 'updatedAt must be an ISO timestamp');
  }
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(preferences), 'utf8');
  } catch {
    throw new ProfileError('INVALID_JSON', 'preferences must be JSON-serializable');
  }
  if (size > MAX_BYTES) throw new ProfileError('TOO_LARGE', `preferences exceed ${MAX_BYTES} bytes`);
}

export class UserProfileStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'user-profiles.json');
  }

  private async readAll(): Promise<Record<string, UserProfile>> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { version?: number; users?: Record<string, UserProfile> };
      return parsed.users && typeof parsed.users === 'object' ? parsed.users : {};
    } catch {
      return {};
    }
  }

  private async writeAll(users: Record<string, UserProfile>): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, users }, null, 2), 'utf8');
    await fs.rename(temporary, this.file);
  }

  async get(userId: string): Promise<UserProfile | null> {
    return (await this.readAll())[userId] ?? null;
  }

  async set(userId: string, preferences: unknown, updatedAt: string, clientId?: string): Promise<ProfileWriteResult> {
    assertPayload(preferences, updatedAt);
    const run = async (): Promise<ProfileWriteResult> => {
      const users = await this.readAll();
      const current = users[userId] ?? null;
      if (current) {
        const currentTime = Date.parse(current.updatedAt);
        const incomingTime = Date.parse(updatedAt);
        if (incomingTime < currentTime) return { applied: false, duplicate: false, conflict: true, profile: current };
        if (incomingTime === currentTime) {
          const same = JSON.stringify(current.preferences) === JSON.stringify(preferences);
          return { applied: false, duplicate: same, conflict: !same, profile: current };
        }
      }
      const profile: UserProfile = { userId, preferences, updatedAt, ...(clientId ? { clientId } : {}) };
      users[userId] = profile;
      await this.writeAll(users);
      return { applied: true, duplicate: false, conflict: false, profile };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
