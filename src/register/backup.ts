/**
 * Backup tool registration — DX-16a.
 *
 * `admin_backup` builds a portable `tar.gz` archive of DATA_DIR per ADR-008.
 * It is admin-only on network transports; on stdio/unix the auth gate treats
 * the caller as a trusted local operator (src/core/auth-gate.ts), so the
 * single-user local workflow keeps working without inventing a second ACL.
 */

import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { ok, err, errWith } from '../utils/respond.js';
import { resolveExtraSessionId, type GateExtra } from '../core/auth-gate.js';
import { DATA_DIR } from '../config.js';
import { BackupArchiveError, createBackupArchive } from '../services/backup-archive.js';

/** Admin on authenticated transports; trusted local pipe otherwise. */
function isAdminCaller(ctx: ServerContext, extra?: GateExtra): boolean {
  const auth = ctx.authManager;
  if (!auth || !auth.isAuthRequired()) return true;
  const sessionId = resolveExtraSessionId(extra);
  if (!sessionId) return false;
  const roles = ctx.sessionManager?.get(sessionId)?.metadata?.roles;
  return Array.isArray(roles) && roles.includes('admin');
}

export function registerBackupTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'admin_backup',
    {
      title: 'Backup DATA_DIR',
      description:
        'Create a portable tar.gz archive of DATA_DIR (ADR-008): manifest.json with formatVersion/profile/schemaVersion/sha256 per entry, deterministic entry order, atomic write via .partial. Secrets (.jwt-revoked.json, auth.db) and caches are excluded unless includeSecrets is set. Requires admin role on authenticated transports. Returns the finished archive size; the manifest inside the archive does not carry archiveBytes.',
      inputSchema: {
        out: z.string().min(1).optional().describe('Output directory for the archive (default: DATA_DIR/.backups)'),
        label: z.string().max(60).optional().describe('Optional suffix for the archive file name'),
        includeSecrets: z.boolean().optional().describe('Include .jwt-revoked.json and auth.db and flag the archive as containing secrets'),
        excludeModels: z.boolean().optional().describe('Skip the models/ directory (installed embedding bundles)'),
      },
    },
    async (
      args: { out?: string; label?: string; includeSecrets?: boolean; excludeModels?: boolean },
      extra?: GateExtra,
    ) => {
      if (!isAdminCaller(ctx, extra)) {
        return err('access denied — admin_backup requires admin role');
      }
      try {
        const result = await createBackupArchive({
          dataDir: DATA_DIR,
          out: args.out,
          label: args.label,
          includeSecrets: args.includeSecrets,
          excludeModels: args.excludeModels,
        });
        return ok({
          archivePath: result.archivePath,
          bytes: result.bytes,
          files: result.files,
          manifest: result.manifest,
        });
      } catch (e) {
        if (e instanceof BackupArchiveError) {
          return errWith({
            message: e.message,
            code: e.code,
            ...(e.hint ? { hint: e.hint } : {}),
          });
        }
        return err((e as Error).message);
      }
    },
  );
}
