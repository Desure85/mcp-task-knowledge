import { z } from 'zod/v3';
/**
 * Z-03 package UI API.
 *
 * Read/edit skill packages and inspect/toggle plugin components from the web UI.
 * Every path goes through `resolveSkillPackagePath`/`normalizeSkillPackageName`;
 * package limits are reused from Z-01.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ServerContext } from './context.js';
import { DATA_DIR } from '../config.js';
import { ok } from '../utils/respond.js';
import {
  SkillPackageStore,
  readSkillPackage,
  writeSkillPackage,
  resolveSkillPackagePath,
  normalizeSkillPackageName,
  normalizeSkillPackagePath,
  SKILL_PACKAGE_LIMITS,
} from '../skills/skill-package.js';
import {
  PLUGIN_MANIFEST_FILE,
  PLUGIN_COMPONENTS,
  readPluginPackage,
  type PluginComponent,
} from '../skills/plugin-container.js';

const SKILL_ROOT = path.join(DATA_DIR, 'skill-packages');
const PLUGIN_ROOT = path.join(DATA_DIR, 'plugins');
const MAX_EDIT_BYTES = 256 * 1024;

function skillStore() {
  return new SkillPackageStore(SKILL_ROOT);
}

function pluginNames(): string[] {
  if (!fs.existsSync(PLUGIN_ROOT)) return [];
  return fs.readdirSync(PLUGIN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function readPlugin(name: string) {
  return readPluginPackage(path.join(PLUGIN_ROOT, normalizeSkillPackageName(name)));
}

function readFileContent(root: string, relative: string): string | null {
  const absolute = resolveSkillPackagePath(root, relative);
  const stat = fs.statSync(absolute);
  if (stat.size > MAX_EDIT_BYTES) return null;
  return fs.readFileSync(absolute, 'utf8');
}

function skillView(name: string) {
  const pkg = skillStore().read(name);
  return {
    kind: 'skill' as const,
    name: pkg.name,
    description: pkg.description,
    totalBytes: pkg.totalBytes,
    files: pkg.files.map((file) => ({
      ...file,
      content: readFileContent(pkg.root, file.path),
    })),
  };
}

function pluginView(name: string) {
  const pkg = readPlugin(name);
  const raw = JSON.parse(fs.readFileSync(path.join(pkg.root, PLUGIN_MANIFEST_FILE), 'utf8')) as Record<string, unknown>;
  const disabled = Array.isArray(raw.disabledComponents)
    ? raw.disabledComponents.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    kind: 'plugin' as const,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    description: pkg.manifest.description ?? '',
    license: pkg.manifest.license ?? null,
    components: pkg.manifest.components,
    disabledComponents: disabled,
    totalBytes: pkg.totalBytes,
    files: pkg.files.map((file) => ({
      path: file.path,
      component: file.component,
      size: file.size,
      sha256: file.sha256,
      content: readFileContent(pkg.root, file.path),
    })),
  };
}

export function registerPackageUiTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    'packages_list',
    {
      title: 'List Skill Packages and Plugins',
      description: 'List skill packages and plugin packages available to the package browser UI.',
      inputSchema: {},
    },
    async () => {
      const skills = skillStore().list().map((pkg) => ({
        kind: 'skill' as const,
        name: pkg.name,
        fileCount: pkg.files.length,
        totalBytes: pkg.totalBytes,
      }));
      const plugins = pluginNames().flatMap((name) => {
        try {
          const view = pluginView(name);
          return [{
            kind: 'plugin' as const,
            name: view.name,
            version: view.version,
            fileCount: view.files.length,
            totalBytes: view.totalBytes,
            componentCount: Object.keys(view.components).length,
          }];
        } catch {
          return [];
        }
      });
      return ok({ skills, plugins });
    },
  );

  ctx.server.registerTool(
    'package_get',
    {
      title: 'Get Package Files',
      description: 'Read a skill package or plugin package file tree and text content (files >256 KiB return content:null).',
      inputSchema: {
        kind: z.enum(['skill', 'plugin']),
        name: z.string().min(1),
      },
    },
    async ({ kind, name }) => ok(kind === 'skill' ? skillView(name) : pluginView(name)),
  );

  ctx.server.registerTool(
    'package_create',
    {
      title: 'Create Skill Package',
      description: 'Create a skill package from relative files. Fails if the package already exists.',
      inputSchema: {
        kind: z.enum(['skill', 'plugin']).default('skill').optional(),
        name: z.string().min(1),
        files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
        version: z.string().default('1.0.0').optional(),
        description: z.string().optional(),
      },
    },
    async ({ kind = 'skill', name, files, version = '1.0.0', description }) => {
      const normalized = normalizeSkillPackageName(name);
      const root = kind === 'plugin' ? PLUGIN_ROOT : SKILL_ROOT;
      const destination = path.join(root, normalized);
      if (fs.existsSync(destination)) {
        return ok({ created: false, error: { code: 'PACKAGE_EXISTS', message: `package already exists: ${normalized}` } });
      }
      fs.mkdirSync(root, { recursive: true });
      const staging = path.join(root, `.staging-${normalized}-${process.pid}-${Date.now()}`);
      try {
        if (kind === 'plugin') {
          if (!/^\d+\.\d+\.\d+$/.test(version)) {
            return ok({ created: false, error: { code: 'MANIFEST_INVALID', message: 'version must be semver' } });
          }
          const components: Record<string, string[]> = {};
          for (const file of files) {
            const absolute = path.join(staging, normalizeSkillPackagePath(file.path));
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, file.content, 'utf8');
            if (file.path === '.mcp.json') {
              (components.mcp ??= []).push(file.path);
              continue;
            }
            const top = file.path.split('/')[0];
            if ((PLUGIN_COMPONENTS as readonly string[]).includes(top)) (components[top] ??= []).push(file.path);
          }
          const manifest = { name: normalized, version, ...(description ? { description } : {}), components };
          fs.writeFileSync(path.join(staging, PLUGIN_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        } else {
          writeSkillPackage(staging, files, { maxFileBytes: MAX_EDIT_BYTES });
        }
        fs.renameSync(staging, destination);
        return ok(kind === 'plugin' ? pluginView(normalized) : skillView(normalized));
      } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
      }
    },
  );

  ctx.server.registerTool(
    'package_write_file',
    {
      title: 'Write Skill Package File',
      description: 'Replace one text file in a skill package. Path traversal is rejected by the package helper.',
      inputSchema: {
        name: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      },
    },
    async ({ name, path: relative, content }) => {
      if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) {
        return ok({ saved: false, error: { code: 'FILE_TOO_LARGE', message: `file exceeds ${MAX_EDIT_BYTES} bytes` } });
      }
      const pkg = skillStore().read(name);
      const absolute = resolveSkillPackagePath(pkg.root, relative);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        return ok({ saved: false, error: { code: 'FILE_NOT_FOUND', message: `file not found: ${relative}` } });
      }
      fs.writeFileSync(absolute, content, 'utf8');
      return ok({ saved: true, name: pkg.name, path: relative, size: Buffer.byteLength(content, 'utf8') });
    },
  );

  ctx.server.registerTool(
    'package_toggle_component',
    {
      title: 'Toggle Plugin Component',
      description: 'Enable or disable one plugin component in plugin.json (disabledComponents); files are not deleted.',
      inputSchema: {
        name: z.string().min(1),
        component: z.enum(PLUGIN_COMPONENTS),
        enabled: z.boolean(),
      },
    },
    async ({ name, component, enabled }) => {
      const pkg = readPlugin(name);
      const manifestPath = path.join(pkg.root, PLUGIN_MANIFEST_FILE);
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const disabled = new Set(
        Array.isArray(raw.disabledComponents)
          ? raw.disabledComponents.filter((item): item is string => typeof item === 'string')
          : [],
      );
      if (enabled) disabled.delete(component);
      else disabled.add(component);
      raw.disabledComponents = [...disabled].sort();
      fs.writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
      return ok({ name: pkg.manifest.name, component: component as PluginComponent, enabled, disabledComponents: raw.disabledComponents });
    },
  );
}

