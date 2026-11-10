import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentDeployError,
  applyAgentDeploy,
  defaultAgentTargets,
  previewAgentDeploy,
  rollbackAgentDeploy,
  type AgentDeployArtifact,
  type AgentDeployOptions,
} from '../src/skills/agent-deploy.js';

const cleanup: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-deploy-'));
  cleanup.push(dir);
  return dir;
}

function file(root: string, relative: string, content: string): string {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function options(home: string): AgentDeployOptions {
  return {
    homeDir: home,
    targets: [
      { target: 'universal', root: path.join(home, 'universal-skills'), format: 'skill-md' },
      { target: 'claude', root: path.join(home, 'claude-skills'), format: 'skill-md' },
      { target: 'opencode', root: path.join(home, 'opencode-skills'), format: 'markdown' },
    ],
    allowDelete: true,
  };
}

function fixture(): { home: string; opts: AgentDeployOptions; artifacts: AgentDeployArtifact[] } {
  const home = tempHome();
  const opts = options(home);
  file(opts.targets![1].root, 'review/SKILL.md', 'old claude skill\n');
  file(opts.targets![0].root, 'removed/SKILL.md', 'remove me\n');
  const artifacts: AgentDeployArtifact[] = [
    { id: 'review', kind: 'skill', target: 'claude', content: 'new claude skill\n' },
    { id: 'notes', kind: 'prompt', target: 'opencode', content: 'new opencode prompt\n' },
    { id: 'removed', kind: 'skill', target: 'universal', delete: true },
  ];
  return { home, opts, artifacts };
}

afterEach(() => {
  for (const dir of cleanup.splice(0).reverse()) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Z-12: agent deployment', () => {
  it('previews create/update/delete without writing anything', () => {
    const { opts, artifacts } = fixture();
    const preview = previewAgentDeploy(artifacts, opts);

    expect(preview.actions.map((action) => action.action).sort()).toEqual(['create', 'delete', 'update']);
    expect(fs.readFileSync(path.join(opts.targets![1].root, 'review', 'SKILL.md'), 'utf8')).toBe('old claude skill\n');
    expect(fs.existsSync(path.join(opts.targets![0].root, 'removed', 'SKILL.md'))).toBe(true);
  });

  it('applies only with confirm=true and rolls back the snapshot', () => {
    const { home, opts, artifacts } = fixture();
    const preview = previewAgentDeploy(artifacts, opts);

    expect(() => applyAgentDeploy(preview, artifacts, false, opts)).toThrowError(
      expect.objectContaining({ code: 'CONFIRM_REQUIRED' }),
    );

    const applied = applyAgentDeploy(preview, artifacts, true, opts);
    expect(applied.snapshotId).toBe(preview.snapshotId);
    expect(fs.readFileSync(path.join(opts.targets![1].root, 'review', 'SKILL.md'), 'utf8')).toBe('new claude skill\n');
    expect(fs.readFileSync(path.join(opts.targets![2].root, 'notes.md'), 'utf8')).toBe('new opencode prompt\n');
    expect(fs.existsSync(path.join(opts.targets![0].root, 'removed', 'SKILL.md'))).toBe(false);

    rollbackAgentDeploy(preview.snapshotId, { ...opts, homeDir: home });
    expect(fs.readFileSync(path.join(opts.targets![1].root, 'review', 'SKILL.md'), 'utf8')).toBe('old claude skill\n');
    expect(fs.existsSync(path.join(opts.targets![2].root, 'notes.md'))).toBe(false);
    expect(fs.readFileSync(path.join(opts.targets![0].root, 'removed', 'SKILL.md'), 'utf8')).toBe('remove me\n');
  });

  it('rejects artifacts outside the target root', () => {
    const home = tempHome();
    const opts = options(home);
    expect(() => previewAgentDeploy([
      { id: '../escape', kind: 'skill', target: 'claude', content: 'x' },
    ], opts)).toThrowError(expect.objectContaining({ code: 'ARTIFACT_INVALID' }));
  });

  it('requires allowExternal for external-trust artifacts', () => {
    const home = tempHome();
    const opts = options(home);
    const artifact: AgentDeployArtifact = {
      id: 'external-skill',
      kind: 'skill',
      target: 'claude',
      content: 'external\n',
      trustLevel: 'external',
    };
    expect(() => previewAgentDeploy([artifact], opts)).toThrowError(
      expect.objectContaining({ code: 'EXTERNAL_NOT_ALLOWED' }),
    );
    const preview = previewAgentDeploy([artifact], { ...opts, allowExternal: true });
    expect(preview.externalIds).toEqual(['external-skill']);
  });

  it('rejects a symlinked destination path', () => {
    const home = tempHome();
    const opts = options(home);
    const outside = path.join(home, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(opts.targets![1].root, { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(opts.targets![1].root, 'linked'), 'junction');
    } catch {
        return; // Windows without symlink privilege: documented environment limitation
    }
    expect(() => previewAgentDeploy([
      { id: 'linked', kind: 'skill', target: 'claude', content: 'x' },
    ], opts)).toThrowError(expect.objectContaining({ code: 'SYMLINK_REJECTED' }));
  });

  it('default targets live under HOME and use skill-md', () => {
    const home = tempHome();
    const targets = defaultAgentTargets(home);
    expect(targets.map((entry) => entry.target)).toEqual(['universal', 'claude', 'opencode']);
    for (const target of targets) {
      expect(target.root.startsWith(path.resolve(home))).toBe(true);
      expect(target.format).toBe('skill-md');
    }
  });
});
