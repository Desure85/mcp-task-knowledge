/**
 * Z-02: plugin container — skills, commands, agents, hooks, `.mcp.json` and attachments.
 *
 * The Z-01 skill package covers one `SKILL.md` with attachments; a plugin is a superset and must
 * round-trip every file, not just the skill body (AI-011/AI-012). This module only reads, validates
 * and copies a plugin directory: no storage contracts and no MCP tools change here.
 *
 * Layout:
 *   plugin.json                 required manifest
 *   skills/<name>/SKILL.md      declared under components.skills
 *   commands/*.md               components.commands
 *   agents/*.md                 components.agents
 *   hooks/*.json                components.hooks
 *   .mcp.json                   components.mcp
 *   <anything else>             preserved as component "other"
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  SKILL_PACKAGE_LIMITS,
  normalizeSkillPackagePath,
  resolveSkillPackagePath,
  SkillPackageError,
  type SkillPackageOptions,
} from './skill-package.js';

export const PLUGIN_MANIFEST_FILE = 'plugin.json';
export const PLUGIN_COMPONENTS = ['skills', 'commands', 'agents', 'hooks', 'mcp'] as const;
export type PluginComponent = (typeof PLUGIN_COMPONENTS)[number] | 'other';

export type PluginPackageErrorCode =
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'COMPONENT_INVALID'
  | 'COMPONENT_PATH_MISSING'
  | 'DEST_EXISTS'
  | 'ROUNDTRIP_MISMATCH'
  | 'PATH_INVALID';

export class PluginPackageError extends Error {
  constructor(
    readonly code: PluginPackageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginPackageError';
  }
}

export interface PluginFile {
  /** POSIX-style path relative to the plugin root. */
  path: string;
  component: PluginComponent;
  size: number;
  sha256: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  components: Partial<Record<PluginComponent, string[]>>;
  /** Files declared by the manifest; empty when the manifest is declaration-only. */
  declaredFiles: string[];
}

export interface PluginPackage {
  root: string;
  manifest: PluginManifest;
  files: PluginFile[];
  totalBytes: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function componentOf(relative: string): PluginComponent {
  if (relative === '.mcp.json') return 'mcp';
  const top = relative.split('/')[0];
  return (PLUGIN_COMPONENTS as readonly string[]).includes(top) ? (top as PluginComponent) : 'other';
}

function expectedPrefix(component: PluginComponent): string | null {
  if (component === 'mcp') return '.mcp.json';
  if (component === 'other') return null;
  return `${component}/`;
}

function listPluginFiles(
  root: string,
  options: Required<SkillPackageOptions>,
  prefix = '',
): Array<{ path: string; absolute: string; size: number }> {
  const result: Array<{ path: string; absolute: string; size: number }> = [];
  const directory = prefix ? path.join(root, ...prefix.split('/')) : root;
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    let relative: string;
    try {
      relative = normalizeSkillPackagePath(prefix ? `${prefix}/${entry.name}` : entry.name, options);
    } catch (error) {
      if (error instanceof SkillPackageError) {
        throw new PluginPackageError('PATH_INVALID', error.message);
      }
      throw error;
    }
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new PluginPackageError('PATH_INVALID', `symlink is not allowed in a plugin: ${relative}`);
    }
    if (stat.isDirectory()) {
      result.push(...listPluginFiles(root, options, relative));
      continue;
    }
    if (!stat.isFile()) {
      throw new PluginPackageError('PATH_INVALID', `unsupported filesystem entry: ${relative}`);
    }
    if (stat.size > options.maxFileBytes) {
      throw new PluginPackageError('PATH_INVALID', `file ${relative} exceeds ${options.maxFileBytes} bytes`);
    }
    result.push({ path: relative, absolute, size: stat.size });
    if (result.length > options.maxFiles) {
      throw new PluginPackageError('PATH_INVALID', `plugin has more than ${options.maxFiles} files`);
    }
  }
  return result;
}

function parseManifest(raw: string): PluginManifest {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new PluginPackageError('MANIFEST_INVALID', `plugin.json is not valid JSON: ${(error as Error).message}`);
  }
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const version = typeof data.version === 'string' ? data.version.trim() : '';
  if (!NAME_RE.test(name)) {
    throw new PluginPackageError('MANIFEST_INVALID', 'plugin.json requires a slug-like "name"');
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new PluginPackageError('MANIFEST_INVALID', 'plugin.json requires a semver "version"');
  }
  const components: Partial<Record<PluginComponent, string[]>> = {};
  const declaredFiles: string[] = [];
  const rawComponents = data.components;
  if (rawComponents !== undefined) {
    if (!rawComponents || typeof rawComponents !== 'object' || Array.isArray(rawComponents)) {
      throw new PluginPackageError('MANIFEST_INVALID', 'components must be an object');
    }
    for (const [key, value] of Object.entries(rawComponents as Record<string, unknown>)) {
      if (!(PLUGIN_COMPONENTS as readonly string[]).includes(key)) {
        throw new PluginPackageError('COMPONENT_INVALID', `unknown plugin component: ${key}`);
      }
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new PluginPackageError('COMPONENT_INVALID', `components.${key} must be an array of paths`);
      }
      components[key as PluginComponent] = value.map((entry) => {
        let normalized: string;
        try {
          normalized = normalizeSkillPackagePath(entry);
        } catch (error) {
          throw new PluginPackageError('COMPONENT_INVALID', (error as Error).message);
        }
        const actual = componentOf(normalized);
        if (actual !== key) {
          throw new PluginPackageError(
            'COMPONENT_INVALID',
            `components.${key} declares ${normalized}, which belongs to ${actual}`,
          );
        }
        return normalized;
      });
      declaredFiles.push(...components[key as PluginComponent]!);
    }
  }
  return {
    name,
    version,
    ...(typeof data.description === 'string' && data.description.trim().length > 0
      ? { description: data.description.trim() }
      : {}),
    components,
    declaredFiles: Array.from(new Set(declaredFiles)),
  };
}

/** Read a plugin directory and verify that every declared component really exists. */
export function readPluginPackage(
  root: string,
  options: SkillPackageOptions = {},
): PluginPackage {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new PluginPackageError('MANIFEST_MISSING', `plugin directory not found: ${root}`);
  }
  const limits: Required<SkillPackageOptions> = {
    maxFileBytes: options.maxFileBytes ?? SKILL_PACKAGE_LIMITS.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? SKILL_PACKAGE_LIMITS.maxTotalBytes,
    maxFiles: options.maxFiles ?? SKILL_PACKAGE_LIMITS.maxFiles,
    maxPathLength: options.maxPathLength ?? SKILL_PACKAGE_LIMITS.maxPathLength,
  };
  const manifestPath = path.join(resolvedRoot, PLUGIN_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new PluginPackageError('MANIFEST_MISSING', `plugin must contain ${PLUGIN_MANIFEST_FILE}`);
  }
  const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  const entries = listPluginFiles(resolvedRoot, limits);
  const known = new Set(entries.map((entry) => entry.path));
  for (const declared of manifest.declaredFiles) {
    if (!known.has(declared)) {
      throw new PluginPackageError('COMPONENT_PATH_MISSING', `declared component file is missing: ${declared}`);
    }
    const component = componentOf(declared);
    if (component === 'other') {
      throw new PluginPackageError('COMPONENT_INVALID', `declared component is outside a known component directory: ${declared}`);
    }
    const prefix = expectedPrefix(component);
    if (prefix !== null && !declared.startsWith(prefix)) {
      throw new PluginPackageError('COMPONENT_INVALID', `${declared} is not under ${prefix}`);
    }
  }
  const files: PluginFile[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = fs.readFileSync(entry.absolute);
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new PluginPackageError('PATH_INVALID', `plugin exceeds ${limits.maxTotalBytes} bytes`);
    }
    files.push({ path: entry.path, component: componentOf(entry.path), size: bytes.length, sha256: sha256(bytes) });
  }
  return { root: resolvedRoot, manifest, files, totalBytes };
}

/**
 * Copy every file (including attachments and binaries) to a fresh directory and verify hashes.
 * The destination must not exist; this keeps the export non-destructive.
 */
export function exportPluginPackage(sourceRoot: string, destRoot: string): PluginPackage {
  const source = readPluginPackage(sourceRoot);
  const resolvedDest = path.resolve(destRoot);
  if (fs.existsSync(resolvedDest)) {
    throw new PluginPackageError('DEST_EXISTS', `destination already exists: ${destRoot}`);
  }
  const staging = `${resolvedDest}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const file of source.files) {
      const from = resolveSkillPackagePath(source.root, file.path);
      const to = resolveSkillPackagePath(staging, file.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    fs.renameSync(staging, resolvedDest);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const exported = readPluginPackage(resolvedDest);
  const before = new Map(source.files.map((file) => [file.path, file.sha256]));
  for (const file of exported.files) {
    if (before.get(file.path) !== file.sha256) {
      throw new PluginPackageError('ROUNDTRIP_MISMATCH', `file changed during export: ${file.path}`);
    }
  }
  if (exported.files.length !== source.files.length) {
    throw new PluginPackageError('ROUNDTRIP_MISMATCH', 'file count changed during export');
  }
  return exported;
}
