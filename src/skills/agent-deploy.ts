/**
 * Z-12: deploy skills/prompts into the directories of their target agent.
 *
 * Deployment is a two-step, explicitly confirmed operation: `previewAgentDeploy` only plans and never
 * writes; `applyAgentDeploy` requires `confirm: true`, writes only under the configured target roots,
 * snapshots every touched file, and `rollbackAgentDeploy` restores that snapshot. Symlinks anywhere on
 * the path are rejected, and external-trust artifacts need a separate `allowExternal`.
 *
 * Formats are intentionally small: `skill-md` writes `<root>/<id>/SKILL.md`, `markdown` writes
 * `<root>/<id>.md`. Hooks/scripts/.mcp.json are not deployable here — Z-04 keeps them disabled.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveUnder } from '../fs.js';
import { normalizeAgentTarget } from '../agents.js';

export type AgentDeployFormat = 'skill-md' | 'markdown';
export type AgentDeployKind = 'skill' | 'prompt';

export interface AgentTargetDeployment {
  target: string;
  /** Absolute directory this target may write into. */
  root: string;
  format: AgentDeployFormat;
}

export interface AgentDeployArtifact {
  id: string;
  kind: AgentDeployKind;
  target: string;
  content: string;
  trustLevel?: 'system' | 'user' | 'external';
  delete?: boolean;
}

export interface AgentDeployAction {
  action: 'create' | 'update' | 'delete';
  id: string;
  target: string;
  path: string;
  bytes: number;
  /** sha256 of the intended content (empty for delete). */
  sha256: string;
}

export interface AgentDeployPreview {
  actions: AgentDeployAction[];
  snapshotId: string;
  token: string;
  externalIds: string[];
}

export interface AgentDeployOptions {
  homeDir?: string;
  targets?: AgentTargetDeployment[];
  allowExternal?: boolean;
  allowDelete?: boolean;
  snapshotRoot?: string;
}

export interface AgentDeployApplied {
  actions: AgentDeployAction[];
  snapshotId: string;
}

export type AgentDeployErrorCode =
  | 'TARGET_UNKNOWN'
  | 'PATH_INVALID'
  | 'PATH_OUTSIDE_ALLOWLIST'
  | 'SYMLINK_REJECTED'
  | 'CONFIRM_REQUIRED'
  | 'EXTERNAL_NOT_ALLOWED'
  | 'DELETE_NOT_ALLOWED'
  | 'SNAPSHOT_NOT_FOUND'
  | 'ARTIFACT_INVALID';

export class AgentDeployError extends Error {
  constructor(
    readonly code: AgentDeployErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentDeployError';
  }
}

export function defaultAgentTargets(homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''): AgentTargetDeployment[] {
  const home = path.resolve(homeDir);
  return [
    { target: 'universal', root: path.join(home, '.agents', 'skills'), format: 'skill-md' },
    { target: 'claude', root: path.join(home, '.claude', 'skills'), format: 'skill-md' },
    { target: 'opencode', root: path.join(home, '.config', 'opencode', 'skills'), format: 'skill-md' },
  ];
}

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function snapshotsRoot(options: AgentDeployOptions): string {
  const home = path.resolve(options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '');
  return options.snapshotRoot ?? path.join(home, '.mcp-task-knowledge', 'deploy-snapshots');
}

function targetsFor(options: AgentDeployOptions): AgentTargetDeployment[] {
  return options.targets ?? defaultAgentTargets(options.homeDir);
}

function targetFor(target: string, options: AgentDeployOptions): AgentTargetDeployment {
  const normalized = normalizeAgentTarget(target);
  const found = targetsFor(options).find((entry) => entry.target === normalized);
  if (!found) throw new AgentDeployError('TARGET_UNKNOWN', `unknown deploy target: ${target}`);
  return found;
}

function artifactPath(artifact: AgentDeployArtifact, deployment: AgentTargetDeployment): string {
  if (!SAFE_ID.test(artifact.id)) {
    throw new AgentDeployError('ARTIFACT_INVALID', `invalid artifact id: ${artifact.id}`);
  }
  const file = artifact.kind === 'skill' && deployment.format === 'skill-md'
    ? path.join(artifact.id, 'SKILL.md')
    : `${artifact.id}.md`;
  try {
    return resolveUnder(deployment.root, ...file.split(path.sep));
  } catch (error) {
    throw new AgentDeployError('PATH_INVALID', (error as Error).message);
  }
}

function assertInsideRoot(file: string, root: string): void {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(file);
  if (absolute !== absoluteRoot && !absolute.startsWith(absoluteRoot + path.sep)) {
    throw new AgentDeployError('PATH_OUTSIDE_ALLOWLIST', `path escapes deploy root: ${file}`);
  }
}

/** Reject symlinks in every existing path component, including the root itself. */
function assertNoSymlink(file: string, root: string): void {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(file);
  assertInsideRoot(absolute, absoluteRoot);
  const relative = path.relative(absoluteRoot, absolute);
  let current = absoluteRoot;
  const rootReal = fs.existsSync(absoluteRoot) ? fs.realpathSync.native(absoluteRoot) : absoluteRoot;
  const segments = relative.length > 0 ? relative.split(path.sep) : [];
  for (const segment of ['', ...segments]) {
    if (segment.length > 0) current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      const real = fs.realpathSync.native(current);
      if (stat.isSymbolicLink() || (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`))) {
        throw new AgentDeployError('SYMLINK_REJECTED', `symlink is not allowed on deploy path: ${current}`);
      }
    } catch (error) {
      if (error instanceof AgentDeployError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function contentHash(actions: AgentDeployAction[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(actions)).digest('hex').slice(0, 16);
}

/** Plan only; nothing on disk is created or changed. */
export function previewAgentDeploy(
  artifacts: AgentDeployArtifact[],
  options: AgentDeployOptions = {},
): AgentDeployPreview {
  const actions: AgentDeployAction[] = [];
  const externalIds: string[] = [];
  for (const artifact of artifacts) {
    const deployment = targetFor(artifact.target, options);
    const file = artifactPath(artifact, deployment);
    assertNoSymlink(file, deployment.root);
    if (artifact.trustLevel === 'external') {
      externalIds.push(artifact.id);
      if (!options.allowExternal) {
        throw new AgentDeployError(
          'EXTERNAL_NOT_ALLOWED',
          `artifact ${artifact.id} is external; pass allowExternal=true to deploy it`,
        );
      }
    }
    if (artifact.delete) {
      if (!options.allowDelete) {
        throw new AgentDeployError('DELETE_NOT_ALLOWED', `delete of ${artifact.id} requires allowDelete=true`);
      }
      if (!fs.existsSync(file)) {
        throw new AgentDeployError('ARTIFACT_INVALID', `cannot delete missing artifact: ${artifact.id}`);
      }
      actions.push({
        action: 'delete',
        id: artifact.id,
        target: deployment.target,
        path: file,
        bytes: 0,
        sha256: '',
      });
      continue;
    }
    const exists = fs.existsSync(file);
    const bytes = Buffer.from(artifact.content, 'utf8');
    actions.push({
      action: exists ? 'update' : 'create',
      id: artifact.id,
      target: deployment.target,
      path: file,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const snapshotId = `deploy-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  return { actions, snapshotId, token: contentHash(actions), externalIds };
}

function copyExisting(file: string, destination: string): void {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}

/** Apply a preview with its artifacts. `confirm` must be literally true; a stale token is rejected. */
export function applyAgentDeploy(
  preview: AgentDeployPreview,
  artifacts: AgentDeployArtifact[],
  confirm: boolean,
  options: AgentDeployOptions = {},
): AgentDeployApplied {
  if (confirm !== true) throw new AgentDeployError('CONFIRM_REQUIRED', 'deploy requires confirm=true');
  if (contentHash(preview.actions) !== preview.token) {
    throw new AgentDeployError('ARTIFACT_INVALID', 'deploy preview does not match its contents');
  }
  const byKey = new Map(artifacts.map((artifact) => [`${normalizeAgentTarget(artifact.target)}:${artifact.id}`, artifact]));
  for (const action of preview.actions) {
    const deployment = targetFor(action.target, options);
    assertInsideRoot(action.path, deployment.root);
    assertNoSymlink(action.path, deployment.root);
    if (action.action !== 'delete') {
      const artifact = byKey.get(`${deployment.target}:${action.id}`);
      if (!artifact) throw new AgentDeployError('ARTIFACT_INVALID', `missing artifact for ${action.id}`);
      const hash = crypto.createHash('sha256').update(Buffer.from(artifact.content, 'utf8')).digest('hex');
      if (hash !== action.sha256) {
        throw new AgentDeployError('ARTIFACT_INVALID', `content changed after preview: ${action.id}`);
      }
    }
  }
  const snapshotDir = path.join(snapshotsRoot(options), preview.snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });
  const manifest = {
    snapshotId: preview.snapshotId,
    createdAt: new Date().toISOString(),
    actions: preview.actions.map((action) => ({
      ...action,
      relative: path.relative(path.resolve(targetFor(action.target, options).root), action.path),
    })),
  };
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  for (const action of preview.actions) {
    if (action.action === 'create') continue;
    const backup = path.join(
      snapshotDir,
      'files',
      action.target,
      path.relative(path.resolve(targetFor(action.target, options).root), action.path),
    );
    copyExisting(action.path, backup);
  }
  for (const action of preview.actions) {
    const artifact = byKey.get(`${normalizeAgentTarget(action.target)}:${action.id}`);
    if (action.action === 'delete') {
      fs.rmSync(action.path, { force: true });
      continue;
    }
    if (!artifact) throw new AgentDeployError('ARTIFACT_INVALID', `missing artifact for ${action.id}`);
    fs.mkdirSync(path.dirname(action.path), { recursive: true });
    const temp = `${action.path}.tmp-${process.pid}-${Date.now().toString(36)}`;
    fs.writeFileSync(temp, artifact.content, 'utf8');
    fs.renameSync(temp, action.path);
  }
  return { actions: preview.actions, snapshotId: preview.snapshotId };
}

/** Restore every file touched by a deploy and remove files that were created. */
export function rollbackAgentDeploy(snapshotId: string, options: AgentDeployOptions = {}): AgentDeployAction[] {
  if (!/^deploy-[a-z0-9-]+$/.test(snapshotId)) {
    throw new AgentDeployError('SNAPSHOT_NOT_FOUND', `invalid snapshot id: ${snapshotId}`);
  }
  const dir = path.join(snapshotsRoot(options), snapshotId);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new AgentDeployError('SNAPSHOT_NOT_FOUND', `snapshot not found: ${snapshotId}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    actions: Array<AgentDeployAction & { relative: string }>;
  };
  for (const action of manifest.actions) {
    const deployment = targetFor(action.target, options);
    const file = resolveUnder(deployment.root, ...action.relative.split(path.sep));
    assertInsideRoot(file, deployment.root);
    assertNoSymlink(file, deployment.root);
    if (action.action === 'create') {
      fs.rmSync(file, { force: true });
      continue;
    }
    const backup = path.join(dir, 'files', action.target, action.relative);
    if (!fs.existsSync(backup)) {
      throw new AgentDeployError('SNAPSHOT_NOT_FOUND', `snapshot is missing ${action.relative}`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(backup, file);
  }
  return manifest.actions.map(({ relative: _relative, ...action }) => action);
}
