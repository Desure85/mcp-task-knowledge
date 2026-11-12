/** DX-26c: `uninstall` removes the managed client config and files recorded by install-agent. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentClient, InstallManifest } from './install-agent.js';

export const UNINSTALL_USAGE = `Usage: node dist/index.js uninstall --client <opencode|claude-code> [--home DIR] [--dry-run]

  --client              client whose install manifest is removed
  --home                target home (default: environment home)
  --dry-run             print the plan without changing anything
`;

function parse(argv: string[]): { client?: AgentClient; home?: string; dryRun: boolean } | string {
  const out: { client?: AgentClient; home?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--client') {
      out.client = argv[++i] as AgentClient;
      if (!out.client) return 'missing value for --client';
    } else if (arg === '--home') {
      out.home = argv[++i];
      if (!out.home) return 'missing value for --home';
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '-h' || arg === '--help') {
      return 'help';
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (!out.client || (out.client !== 'opencode' && out.client !== 'claude-code')) {
    return '--client must be opencode or claude-code';
  }
  return out;
}

function sha(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function manifestPath(home: string, client: AgentClient): string {
  return path.join(home, '.mcp-task-knowledge', `${client}-install-manifest.json`);
}

function configPath(client: AgentClient, home: string, env: NodeJS.ProcessEnv): string {
  if (client === 'opencode') {
    const candidate = env.XDG_CONFIG_HOME;
    const base = candidate && path.resolve(candidate).startsWith(path.resolve(home) + path.sep)
      ? path.resolve(candidate)
      : path.join(home, '.config');
    return path.join(base, 'opencode', 'opencode.json');
  }
  return path.join(home, '.claude.json');
}

export interface UninstallResult {
  removedFiles: number;
  removedConfigEntry: boolean;
  skipped: string[];
  dryRun: boolean;
}

export function uninstallAgent(
  client: AgentClient,
  home: string,
  env: NodeJS.ProcessEnv,
  dryRun: boolean,
): UninstallResult {
  const manifestFile = manifestPath(home, client);
  if (!fs.existsSync(manifestFile)) {
    return { removedFiles: 0, removedConfigEntry: false, skipped: [], dryRun };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as InstallManifest;
  const skipped: string[] = [];
  let removedFiles = 0;
  let removedConfigEntry = false;

  for (const entry of manifest.files) {
    const target = path.resolve(home, entry.target);
    if (!target.startsWith(path.resolve(home) + path.sep)) {
      skipped.push(`${entry.target}: outside home`);
      continue;
    }
    if (entry.config) {
      if (!fs.existsSync(target)) continue;
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>;
      const key = client === 'opencode' ? 'mcp' : 'mcpServers';
      const registry = parsed[key];
      if (registry && typeof registry === 'object' && !Array.isArray(registry)) {
        const entries = registry as Record<string, unknown>;
        const name = Object.keys(entries).find((candidate) => candidate === 'mcp-task-knowledge');
        if (name) {
          delete entries[name];
          if (!dryRun) fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);
          removedConfigEntry = true;
        }
      }
      continue;
    }
    if (!fs.existsSync(target)) continue;
    if (sha(target) !== entry.sha256) {
      skipped.push(`${entry.target}: modified since install`);
      continue;
    }
    if (!dryRun) fs.unlinkSync(target);
    removedFiles++;
  }

  if (!dryRun) {
    fs.unlinkSync(manifestFile);
    const dir = path.dirname(manifestFile);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return { removedFiles, removedConfigEntry, skipped, dryRun };
}

export async function runUninstallCli(argv: string[]): Promise<number> {
  const parsed = parse(argv);
  if (parsed === 'help') {
    process.stdout.write(UNINSTALL_USAGE);
    return 0;
  }
  if (typeof parsed === 'string') {
    process.stderr.write(`uninstall: ${parsed}\n${UNINSTALL_USAGE}`);
    return 2;
  }
  const home = path.resolve(parsed.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '');
  if (!home) {
    process.stderr.write('uninstall: cannot resolve home; pass --home\n');
    return 2;
  }
  try {
    const result = uninstallAgent(parsed.client!, home, process.env, parsed.dryRun);
    const prefix = result.dryRun ? 'would remove' : 'removed';
    process.stdout.write(
      `uninstall: ${prefix} ${result.removedFiles} file(s), ${result.removedConfigEntry ? (result.dryRun ? 'would remove' : 'removed') : 'no'} config entry` +
        (result.skipped.length ? `; skipped ${result.skipped.length}: ${result.skipped.join(', ')}` : '') +
        '\n',
    );
    return 0;
  } catch (error) {
    process.stderr.write(`uninstall: ${(error as Error).message}\n`);
    return 1;
  }
}
