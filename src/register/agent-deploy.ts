/**
 * Z-12 MCP surface: preview/apply/rollback agent deployment.
 *
 * `apply: false` is a pure dry-run. `apply: true` without `confirm: true` goes through MCP
 * elicitation; a client without elicitation capability gets a refusal instead of a write.
 */

import { z } from 'zod/v3';
import type { ServerContext } from './context.js';
import { ok, err, errWith } from '../utils/respond.js';
import { elicitConfirm } from '../core/elicitation.js';
import { resolveExtraSessionId } from '../core/auth-gate.js';
import type { GateExtra } from '../core/auth-gate.js';
import {
  AgentDeployError,
  applyAgentDeploy,
  previewAgentDeploy,
  rollbackAgentDeploy,
  type AgentDeployArtifact,
} from '../skills/agent-deploy.js';

const artifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['skill', 'prompt']),
  target: z.string().min(1),
  content: z.string(),
  trustLevel: z.enum(['system', 'user', 'external']).optional(),
  delete: z.boolean().optional(),
});

function adminDenied(ctx: ServerContext, extra?: GateExtra): string | null {
  if (ctx.transportType === 'stdio' && !ctx.authManager) return null;
  const sessionId = resolveExtraSessionId(extra);
  const roles = sessionId ? ctx.sessionManager?.get(sessionId)?.metadata?.roles : undefined;
  if (Array.isArray(roles) && roles.includes('admin')) return null;
  return 'access denied — admin role required to deploy';
}

export function registerAgentDeployTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'agents_deploy',
    {
      title: 'Deploy Agent Skills/Prompts',
      description:
        'Preview or apply deployment of skills/prompts into their target agent directories. Preview writes nothing; apply requires confirm (MCP elicitation when not supplied) and snapshots every touched file.',
      inputSchema: {
        artifacts: z.array(artifactSchema).min(1).max(100),
        apply: z.boolean().optional(),
        confirm: z.boolean().optional(),
        previewToken: z.string().optional(),
        allowExternal: z.boolean().optional(),
        allowDelete: z.boolean().optional(),
      },
    },
    async ({
      artifacts,
      apply,
      confirm,
      previewToken,
      allowExternal,
      allowDelete,
    }: {
      artifacts: AgentDeployArtifact[];
      apply?: boolean;
      confirm?: boolean;
      previewToken?: string;
      allowExternal?: boolean;
      allowDelete?: boolean;
    }, extra?: GateExtra) => {
      const options = {
        ...(allowExternal ? { allowExternal } : {}),
        ...(allowDelete ? { allowDelete } : {}),
      };
      try {
        const preview = previewAgentDeploy(artifacts, options);
        if (apply !== true) {
          return ok({ dryRun: true, preview });
        }
        if (previewToken !== undefined && previewToken !== preview.token) {
          return err(`deploy preview token mismatch: expected ${preview.token}`);
        }
        let confirmed = confirm === true;
        if (!confirmed) {
          const elicited = await elicitConfirm(
            ctx,
            `Deploy ${preview.actions.length} file(s) to agent target(s)? This writes outside DATA_DIR.`,
          );
          confirmed = elicited === 'accepted';
          if (!confirmed) {
            return err(`deploy not confirmed (elicitation ${elicited}): pass confirm=true to proceed`);
          }
        }
        const denied = adminDenied(ctx, extra);
        if (denied) return err(denied);
        const applied = applyAgentDeploy(preview, artifacts, true, options);
        return ok({ dryRun: false, applied });
      } catch (e) {
        if (e instanceof AgentDeployError) return errWith({ code: e.code, message: e.message });
        throw e;
      }
    },
  );

  ctx.server.registerTool(
    'agents_deploy_rollback',
    {
      title: 'Rollback Agent Deployment',
      description: 'Restore the files captured in a deploy snapshot and remove files it created.',
      inputSchema: { snapshotId: z.string().min(1), confirm: z.boolean().optional() },
    },
    async ({ snapshotId, confirm }: { snapshotId: string; confirm?: boolean }, extra?: GateExtra) => {
      try {
        if (confirm !== true) {
          const elicited = await elicitConfirm(ctx, `Rollback deployment snapshot ${snapshotId}?`);
          if (elicited !== 'accepted') {
            return err(`rollback not confirmed (elicitation ${elicited}): pass confirm=true to proceed`);
          }
        }
        return ok({ snapshotId, restored: rollbackAgentDeploy(snapshotId) });
      } catch (e) {
        if (e instanceof AgentDeployError) return errWith({ code: e.code, message: e.message });
        throw e;
      }
    },
  );
}
