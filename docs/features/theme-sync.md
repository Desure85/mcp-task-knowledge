# Server profile theme sync (UI-33a)

The theme choice and custom theme list live in the user's server profile; localStorage remains the
paint cache. One snapshot is stored as a single preferences object, so reconciliation is idempotent.

## Server tools

- `profile_get` → `{ userId, profile: { userId, preferences, updatedAt, clientId? } | null }`
- `profile_set({ preferences, updatedAt, clientId? })` → `{ applied, duplicate, conflict, profile }`
  - last write wins by `updatedAt`;
  - an older write returns `conflict: true` with the current profile and is not applied;
  - equal timestamps with equal payloads are `duplicate: true`; equal timestamps with different
    payloads conflict.
- Storage: `DATA_DIR/user-profiles.json`, atomic temp+rename, 32 KiB payload cap, serialized writes.
- Authenticated transports use `AuthManager.getUserId(sessionId)`; local stdio has no identity and
  uses one `local` profile.

## Client snapshot

```ts
{
  version: 1,
  theme: 'indigo' | 'petrol' | 'copper',
  mode: 'light' | 'dark' | 'system',
  customThemes: { version: 1, themes: [...] },
  activeCustomId: string | null,
  updatedAt: ISO timestamp
}
```

- `ThemeSync` (mounted in AppShell when the gate is ready) fetches the server profile:
  newer server → write cache + apply; newer local → push; no server → push local.
- Every local `mcp:theme-change` (palette switch, custom theme add/delete) pushes the same
  snapshot. A single `mcp.themePending` slot queues the latest offline snapshot; `online` or the
  next mount retries it. No append-style writes, so retries cannot duplicate themes.
- Server-applied events include the theme/mode and `source: 'server'`; ThemeSync ignores them and
  ThemeManager writes only the given theme/mode.

## Limits

- Sync happens on mount/login and on changes, not via a live subscription; another device sees the
  update on reload/login.
- Offline queue keeps only the latest snapshot (last write wins; no merge across devices).
- `updatedAt` is client-supplied; clock skew can decide the winner. Equal-time divergent writes
  return a conflict and the client applies the server value on the next pass.
- Local stdio users share the `local` profile; per-user sync needs an authenticated transport.
- The profile JSON is not encrypted; keep secrets out of preferences.
- Custom-theme deletion propagation is snapshot-based (empty list/active null); no tombstone.
