/**
 * UI-33a — server profile sync for the theme choice.
 *
 * localStorage remains the paint cache; the server profile is the source of
 * truth after login. A single snapshot (theme + mode + custom themes + active
 * id) is written as one preferences object, so repeated syncs are idempotent
 * and cannot append duplicates. Newer `updatedAt` wins; offline writes are
 * kept in a single pending slot and retried.
 */
import {
  applyTheme,
  readStoredTheme,
  saveTheme,
  THEME_STORAGE_KEY,
  type ModeChoice,
  type ThemeName,
} from './theme';
import {
  applyCustomTheme,
  clearCustomTheme,
  readActiveCustomId,
  readCustomThemes,
  writeActiveCustomId,
  writeCustomThemes,
  type CustomThemeStore,
} from './custom-theme';

export const THEME_UPDATED_KEY = 'mcp.themeUpdatedAt';
export const THEME_PENDING_KEY = 'mcp.themePending';

export interface ThemeSnapshot {
  version: 1;
  theme: ThemeName;
  mode: ModeChoice;
  customThemes: CustomThemeStore;
  activeCustomId: string | null;
  updatedAt: string;
}

export interface ServerThemeProfile {
  userId: string;
  profile: { preferences: unknown; updatedAt: string } | null;
}

export interface ThemeProfileClient {
  get(): Promise<{ userId: string; profile: { preferences: unknown; updatedAt: string } | null }>;
  set(preferences: unknown, updatedAt: string): Promise<{ applied: boolean; duplicate?: boolean; conflict?: boolean }>;
}

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem' | 'removeItem'> | null | undefined;

function nowIso(): string {
  return new Date().toISOString();
}

function isSnapshot(value: unknown): value is ThemeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ThemeSnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.theme === 'string' &&
    typeof candidate.mode === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    candidate.customThemes !== undefined &&
    (candidate.activeCustomId === null || typeof candidate.activeCustomId === 'string')
  );
}

export function readLocalThemeSnapshot(storage: Readable): ThemeSnapshot {
  const stored = readStoredTheme(storage);
  let updatedAt = '1970-01-01T00:00:00.000Z';
  try {
    updatedAt = storage?.getItem(THEME_UPDATED_KEY) ?? updatedAt;
  } catch {
    /* blocked storage */
  }
  return {
    version: 1,
    theme: stored.theme,
    mode: stored.mode,
    customThemes: readCustomThemes(storage),
    activeCustomId: readActiveCustomId(storage),
    updatedAt,
  };
}

/** Persist a snapshot into the paint cache and optionally announce it. */
export function writeLocalThemeSnapshot(storage: Writable & { setItem?: Storage['setItem'] }, snapshot: ThemeSnapshot): void {
  saveTheme(storage, { theme: snapshot.theme, mode: snapshot.mode });
  writeCustomThemes(storage, snapshot.customThemes);
  writeActiveCustomId(storage, snapshot.activeCustomId);
  try {
    storage?.setItem(THEME_UPDATED_KEY, snapshot.updatedAt);
  } catch {
    /* blocked storage */
  }
}

/** Apply a snapshot to the document root, dispatching a source-tagged event. */
export function applyThemeSnapshot(snapshot: ThemeSnapshot, systemDark = false): void {
  const root = document.documentElement;
  const custom = snapshot.activeCustomId
    ? snapshot.customThemes.themes.find((theme) => theme.id === snapshot.activeCustomId)
    : undefined;
  if (custom) {
    const result = applyCustomTheme(root, custom, systemDark ? 'dark' : 'light');
    if (!result.ok) applyTheme(root, snapshot.theme, snapshot.mode, systemDark);
  } else {
    clearCustomTheme(root);
    applyTheme(root, snapshot.theme, snapshot.mode, systemDark);
  }
  window.dispatchEvent(
    new CustomEvent('mcp:theme-change', {
      detail: { theme: snapshot.theme, mode: snapshot.mode, source: 'server' },
    }),
  );
}

export function mergeThemeSnapshots(local: ThemeSnapshot, server: ThemeSnapshot | null): ThemeSnapshot {
  if (!server) return local;
  return Date.parse(server.updatedAt) >= Date.parse(local.updatedAt) ? server : local;
}

export function readPendingSnapshot(storage: Readable): ThemeSnapshot | null {
  try {
    const raw = storage?.getItem(THEME_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePendingSnapshot(storage: Writable, snapshot: ThemeSnapshot | null): void {
  try {
    if (snapshot) storage?.setItem(THEME_PENDING_KEY, JSON.stringify(snapshot));
    else storage?.removeItem(THEME_PENDING_KEY);
  } catch {
    /* blocked storage */
  }
}

function fromServer(profile: ServerThemeProfile['profile']): ThemeSnapshot | null {
  if (!profile || typeof profile.preferences !== 'object' || profile.preferences === null) return null;
  const candidate = profile.preferences as Partial<ThemeSnapshot>;
  if (!isSnapshot({ ...candidate, updatedAt: profile.updatedAt })) return null;
  return { ...candidate, updatedAt: profile.updatedAt } as ThemeSnapshot;
}

async function push(client: ThemeProfileClient, snapshot: ThemeSnapshot): Promise<'pushed' | 'duplicate' | 'offline'> {
  try {
    const result = await client.set(
      {
        version: snapshot.version,
        theme: snapshot.theme,
        mode: snapshot.mode,
        customThemes: snapshot.customThemes,
        activeCustomId: snapshot.activeCustomId,
      },
      snapshot.updatedAt,
    );
    if (result.applied) return 'pushed';
    return 'duplicate';
  } catch {
    return 'offline';
  }
}

/**
 * One reconciliation pass. Returns what happened so the caller can show a
 * status if needed. Pending offline writes are attempted before fetching.
 */
export async function syncThemeProfile(
  client: ThemeProfileClient,
  storage: Storage = window.localStorage,
): Promise<'server-applied' | 'pushed' | 'in-sync' | 'offline'> {
  const local = readLocalThemeSnapshot(storage);
  const pending = readPendingSnapshot(storage);
  if (pending) {
    const outcome = await push(client, pending);
    if (outcome === 'offline') return 'offline';
    writePendingSnapshot(storage, null);
  }

  let remote: ServerThemeProfile;
  try {
    remote = await client.get();
  } catch {
    return 'offline';
  }
  const server = fromServer(remote.profile);
  if (!server) {
    const snapshot = { ...local, updatedAt: nowIso() };
    writeLocalThemeSnapshot(storage, snapshot);
    const outcome = await push(client, snapshot);
    if (outcome === 'offline') writePendingSnapshot(storage, snapshot);
    return outcome === 'offline' ? 'offline' : 'pushed';
  }
  if (Date.parse(server.updatedAt) > Date.parse(local.updatedAt)) {
    writeLocalThemeSnapshot(storage, server);
    applyThemeSnapshot(server, window.matchMedia?.('(prefers-color-scheme: dark)').matches === true);
    return 'server-applied';
  }
  if (Date.parse(local.updatedAt) > Date.parse(server.updatedAt)) {
    const outcome = await push(client, local);
    if (outcome === 'offline') writePendingSnapshot(storage, local);
    return outcome === 'offline' ? 'offline' : 'pushed';
  }
  return 'in-sync';
}

/** Build and push after a local theme change; queued offline on failure. */
export async function pushLocalThemeChange(
  client: ThemeProfileClient,
  storage: Storage = window.localStorage,
): Promise<'pushed' | 'offline'> {
  const snapshot = { ...readLocalThemeSnapshot(storage), updatedAt: nowIso() };
  writeLocalThemeSnapshot(storage, snapshot);
  const outcome = await push(client, snapshot);
  if (outcome === 'offline') writePendingSnapshot(storage, snapshot);
  return outcome === 'offline' ? 'offline' : 'pushed';
}
