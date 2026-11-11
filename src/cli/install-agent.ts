/**
 * AA-07 — `install-agent` for the bundle.
 *
 * Node-only (no bash), idempotent, dry-run capable, backs up every file it
 * changes and can restore the exact pre-install state. Components are declared
 * in `bundle.json`; their sha256 is verified before any target is touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type AgentClient = 'opencode' | 'claude-code';
export type TargetRoot = 'opencode' | 'claude' | 'share';

export interface BundleComponent {
  id: string;
  category: string;
  version: string;
  source: string;
  sha256: string;
  targets: Partial<Record<AgentClient, { root: TargetRoot; path: string }>>;
}

export interface Bundle {
  schema: number;
  name: string;
  version: string;
  server: { package: string; version: string; command: string[]; sha256: string };
  components: BundleComponent[];
}

export interface InstallManifestEntry {
  target: string;
  sha256: string;
  backupRel: string | null;
  config: boolean;
}

export interface InstallManifest {
  schema: 1;
  client: AgentClient;
  bundleVersion: string;
  installedAt: string;
  files: InstallManifestEntry[];
}

export interface InstallAction {
  target: string;
  kind: 'create' | 'update' | 'unchanged' | 'config';
  source?: string;
}

export interface InstallResult {
  exitCode: number;
  text: string;
  actions: InstallAction[];
  manifestPath?: string;
}

export interface InstallOptions {
  home?: string;
  cwd?: string;
  bundlePath?: string;
  sourceRoot?: string;
  env?: NodeJS.ProcessEnv;
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MANIFEST_NAME = 'install-manifest.json';
const BACKUP_DIR = 'backups';

function sha(buffer: Buffer | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeRelative(value: string): string {
  const normal = value.replace(/\\/g, '/');
  if (!normal || normal.startsWith('/') || /^[a-zA-Z]:/.test(normal) || normal.split('/').some((p) => p === '..' || p === '' || p === '.')) {
    throw new Error(`unsafe bundle path: ${value}`);
  }
  return normal;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function parseArgs(args: string[]): { client?: AgentClient; home?: string; bundle?: string; dryRun: boolean; rollback: boolean } {
  const out: { client?: AgentClient; home?: string; bundle?: string; dryRun: boolean; rollback: boolean } = { dryRun: false, rollback: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--client') out.client = args[++i] as AgentClient;
    else if (arg === '--home') out.home = args[++i];
    else if (arg === '--bundle') out.bundle = args[++i];
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--rollback') out.rollback = true;
    else if (arg === '--help' || arg === '-h') {
      throw new Error('usage: install-agent --client <opencode|claude-code> [--home DIR] [--bundle FILE] [--dry-run] [--rollback]');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

function roots(home: string, env: NodeJS.ProcessEnv): Record<TargetRoot, string> {
  const insideHome = (candidate: string | undefined): string | null => {
    if (!candidate) return null;
    const resolved = path.resolve(candidate);
    return resolved === home || resolved.startsWith(home + path.sep) ? resolved : null;
  };
  return {
    opencode: path.join(insideHome(env.XDG_CONFIG_HOME) ?? path.join(home, '.config'), 'opencode'),
    claude: path.join(home, '.claude'),
    share: path.join(insideHome(env.XDG_DATA_HOME) ?? path.join(home, '.local', 'share'), 'mcp-task-knowledge'),
  };
}

function configTargetPath(client: AgentClient, home: string, env: NodeJS.ProcessEnv): string {
  if (client === 'opencode') return path.join(roots(home, env).opencode, 'opencode.json');
  return path.join(home, '.claude.json');
}

function manifestPath(home: string, client: AgentClient): string {
  return path.join(home, '.mcp-task-knowledge', `${client}-${MANIFEST_NAME}`);
}

function loadManifest(home: string, client: AgentClient): InstallManifest | null {
  try {
    return readJson<InstallManifest>(manifestPath(home, client));
  } catch {
    return null;
  }
}

function resolveTarget(home: string, env: NodeJS.ProcessEnv, target: { root: TargetRoot; path: string }): string {
  const resolved = path.resolve(roots(home, env)[target.root], safeRelative(target.path));
  if (!resolved.startsWith(path.resolve(home) + path.sep)) throw new Error(`target escapes home: ${target.path}`);
  return resolved;
}

function sameFile(file: string, expected: string): boolean {
  try {
    return sha(fs.readFileSync(file)) === expected;
  } catch {
    return false;
  }
}

function serverEntry(bundle: Bundle) {
  return { command: 'npx', args: bundle.server.command.slice(1) };
}

function configEntry(client: AgentClient, bundle: Bundle): unknown {
  if (client === 'opencode') return { type: 'local', command: bundle.server.command, enabled: true };
  return serverEntry(bundle);
}

function mergeConfig(client: AgentClient, bundle: Bundle, current: Record<string, unknown>): Record<string, unknown> {
  if (client === 'opencode') {
    const mcp = (current.mcp && typeof current.mcp === 'object' && !Array.isArray(current.mcp)) ? current.mcp as Record<string, unknown> : {};
    return { ...current, mcp: { ...mcp, [bundle.name]: configEntry(client, bundle) } };
  }
  const servers = (current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers))
    ? current.mcpServers as Record<string, unknown> : {};
  return { ...current, mcpServers: { ...servers, [bundle.name]: configEntry(client, bundle) } };
}

function entryEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function backupFile(home: string, client: AgentClient, target: string, stamp: string, previous: Map<string, InstallManifestEntry>): string | null {
  const previousEntry = previous.get(target);
  if (previousEntry) return previousEntry.backupRel;
  if (!fs.existsSync(target)) return null;
  const rel = path.join('.mcp-task-knowledge', BACKUP_DIR, client, stamp, `${sha(target).slice(0, 12)}-${path.basename(target)}`);
  const abs = path.join(home, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(target, abs);
  return rel.replace(/\\/g, '/');
}

function writeFileAtomic(target: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.install-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, target);
}

function install(bundle: Bundle, client: AgentClient, home: string, env: NodeJS.ProcessEnv, dryRun: boolean, sourceRoot: string): InstallResult {
  const actions: InstallAction[] = [];
  const previousManifest = loadManifest(home, client);
  const previous = new Map((previousManifest?.files ?? []).map((file) => [path.resolve(home, file.target), file]));
  const planned: Array<{ target: string; source?: string; content?: string; sha256: string; config: boolean }> = [];

  for (const component of bundle.components) {
    const targetSpec = component.targets[client];
    if (!targetSpec) continue;
    const source = path.resolve(sourceRoot, safeRelative(component.source));
    let sourceBuffer: Buffer;
    try {
      sourceBuffer = fs.readFileSync(source);
      sourceBuffer = Buffer.from(sourceBuffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    } catch {
      throw new Error(`bundle source missing: ${component.source}`);
    }
    if (sha(sourceBuffer) !== component.sha256) throw new Error(`bundle hash mismatch: ${component.source}`);
    const target = resolveTarget(home, env, targetSpec);
    const unchanged = sameFile(target, component.sha256);
    actions.push({ target, kind: unchanged ? 'unchanged' : fs.existsSync(target) ? 'update' : 'create', source: component.source });
    if (!unchanged) planned.push({ target, source: component.source, content: sourceBuffer.toString('utf8'), sha256: component.sha256, config: false });
  }

  // MCP server config is itself managed: backed up, compared and restored.
  const configTarget = configTargetPath(client, home, env);
  let configText: string | null = null;
  try {
    const original = fs.existsSync(configTarget) ? fs.readFileSync(configTarget, 'utf8') : '{}';
    const parsed = JSON.parse(original) as Record<string, unknown>;
    const merged = mergeConfig(client, bundle, parsed);
    configText = `${JSON.stringify(merged, null, 2)}\n`;
    const current = JSON.parse(original) as Record<string, unknown>;
    const same = entryEquals((client === 'opencode' ? (current.mcp as Record<string, unknown> | undefined)?.[bundle.name] : (current.mcpServers as Record<string, unknown> | undefined)?.[bundle.name]), configEntry(client, bundle));
    actions.push({ target: configTarget, kind: same ? 'unchanged' : 'config' });
    if (!same) planned.push({ target: configTarget, content: configText, sha256: sha(configText), config: true });
  } catch (error) {
    throw new Error(`cannot update ${configTarget}: ${(error as Error).message}`);
  }

  if (dryRun) {
    const text = actions.map((action) => `${action.kind}: ${action.target}`).join('\n');
    return { exitCode: 0, text: `dry-run (no writes)\n${text || 'no changes'}`, actions };
  }

  if (planned.length === 0) {
    return { exitCode: 0, text: 'no changes', actions };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileMap = new Map((previousManifest?.files ?? []).map((file) => [path.resolve(home, file.target), file]));
  for (const item of planned) {
    const backupRel = backupFile(home, client, item.target, stamp, previous);
    writeFileAtomic(item.target, item.content!);
    if (!sameFile(item.target, item.sha256)) throw new Error(`target hash mismatch after write: ${item.target}`);
    fileMap.set(item.target, { target: path.relative(home, item.target).replace(/\\/g, '/'), sha256: item.sha256, backupRel, config: item.config });
  }
  const files = [...fileMap.values()];
  const manifest: InstallManifest = {
    schema: 1,
    client,
    bundleVersion: bundle.version,
    installedAt: new Date().toISOString(),
    files,
  };
  writeFileAtomic(manifestPath(home, client), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    exitCode: 0,
    text: `installed ${files.length} file(s) for ${client}\n${actions.map((a) => `${a.kind}: ${a.target}`).join('\n')}`,
    actions,
    manifestPath: manifestPath(home, client),
  };
}

function rollback(home: string, client: AgentClient, dryRun: boolean): InstallResult {
  const manifest = loadManifest(home, client);
  if (!manifest) return { exitCode: 0, text: `no install manifest for ${client}`, actions: [] };
  const actions: InstallAction[] = [];
  for (const file of [...manifest.files].reverse()) {
    const target = path.resolve(home, file.target);
    if (file.backupRel) {
      const backup = path.resolve(home, file.backupRel);
      actions.push({ target, kind: 'config' });
      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backup, target);
      }
    } else {
      actions.push({ target, kind: 'update' });
      if (!dryRun) fs.rmSync(target, { force: true });
    }
  }
  if (!dryRun) {
    fs.rmSync(manifestPath(home, client), { force: true });
    fs.rmSync(path.join(home, '.mcp-task-knowledge', BACKUP_DIR, client), { recursive: true, force: true });
  }
  return {
    exitCode: 0,
    text: `${dryRun ? 'dry-run rollback' : 'rolled back'} ${manifest.files.length} file(s) for ${client}\n${actions.map((a) => `restore: ${a.target}`).join('\n')}`,
    actions,
  };
}

export function runInstallAgent(args: string[], options: InstallOptions = {}): InstallResult {
  const parsed = parseArgs(args);
  if (!parsed.client || (parsed.client !== 'opencode' && parsed.client !== 'claude-code')) {
    return { exitCode: 2, text: 'install-agent: --client must be opencode or claude-code', actions: [] };
  }
  const home = path.resolve(parsed.home ?? options.home ?? os.homedir());
  const env = options.env ?? process.env;
  try {
    if (parsed.rollback) return rollback(home, parsed.client, parsed.dryRun);
    const root = path.resolve(options.cwd ?? PACKAGE_ROOT);
    const bundlePath = parsed.bundle ?? options.bundlePath ?? path.join(root, 'bundle.json');
    const bundle = readJson<Bundle>(bundlePath);
    if (bundle.schema !== 1 || !Array.isArray(bundle.components)) throw new Error('unsupported bundle schema');
    return install(bundle, parsed.client, home, env, parsed.dryRun, path.resolve(options.sourceRoot ?? root));
  } catch (error) {
    return { exitCode: 2, text: `install-agent: ${(error as Error).message}`, actions: [] };
  }
}

export async function runInstallAgentCli(args: string[]): Promise<void> {
  const result = runInstallAgent(args);
  if (result.text) {
    if (result.exitCode === 0) process.stdout.write(`${result.text}\n`);
    else process.stderr.write(`${result.text}\n`);
  }
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
