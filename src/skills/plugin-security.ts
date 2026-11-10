/**
 * Z-04: package security. Everything that came from a plugin directory is `external` — it is not the
 * user's own code. Scripts, hooks and `.mcp.json` are surfaced explicitly and stay disabled until the
 * caller makes a separate, named decision. Network use is opt-in and reported per file.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PluginComponent, PluginPackage } from './plugin-container.js';
import { resolveSkillPackagePath } from './skill-package.js';

export type PluginSecurityErrorCode =
  | 'ACTIVATION_DENIED'
  | 'UNKNOWN_COMPONENT'
  | 'NETWORK_NOT_ALLOWED';

export class PluginSecurityError extends Error {
  constructor(
    readonly code: PluginSecurityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginSecurityError';
  }
}

export interface PluginSecurityFile {
  path: string;
  component: PluginComponent;
  trustLevel: 'external';
  executable: boolean;
  network: boolean;
  enabled: false;
}

export interface PluginLicenseInfo {
  declared?: string;
  file?: string;
}

export interface PluginSecurityReport {
  trustLevel: 'external';
  files: PluginSecurityFile[];
  hooks: string[];
  mcpConfig: string | null;
  executableFiles: string[];
  networkFiles: string[];
  license: PluginLicenseInfo;
  warnings: string[];
}

export interface PluginActivationRequest {
  /** Components the caller wants to use; empty/omitted means everything stays off. */
  enableComponents?: PluginComponent[];
  allowScripts?: boolean;
  allowHooks?: boolean;
  allowMcp?: boolean;
  allowNetwork?: boolean;
}

export interface PluginActivation {
  enabledComponents: PluginComponent[];
  enabledFiles: string[];
  networkEnabled: boolean;
  report: PluginSecurityReport;
}

const EXECUTABLE_RE = /\.(?:sh|bash|zsh|fish|ps1|bat|cmd|js|mjs|cjs|ts|tsx|py|rb|pl|php|jar|exe)$/i;
const LICENSE_RE = /^(?:license|licence|copying)(?:\.(?:md|txt|rst))?$/i;
const NETWORK_RE = /\b(?:https?:\/\/|fetch\s*\(|axios\b|net\.connect\b|new\s+WebSocket\b|require\s*\(\s*['"]https?)/i;

function isExecutable(relative: string): boolean {
  return EXECUTABLE_RE.test(relative);
}

function readTextIfSmall(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 256 * 1024) return null;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) return null;
    return bytes.toString('utf8');
  } catch {
    return null;
  }
}

/** Read every file's security posture. Nothing is enabled here. */
export function inspectPluginSecurity(pkg: PluginPackage): PluginSecurityReport {
  let licenseFile: string | undefined;
  for (const file of pkg.files) {
    const base = file.path.split('/').pop() ?? file.path;
    if (!file.path.includes('/') || file.path.startsWith('skills/')) {
      if (LICENSE_RE.test(base)) licenseFile = file.path;
    }
    if (!licenseFile && LICENSE_RE.test(base)) licenseFile = file.path;
  }
  const files: PluginSecurityFile[] = pkg.files.map((file) => {
    const absolute = resolveSkillPackagePath(pkg.root, file.path);
    const text = readTextIfSmall(absolute);
    return {
      path: file.path,
      component: file.component,
      trustLevel: 'external',
      executable: isExecutable(file.path),
      network: text !== null && NETWORK_RE.test(text),
      enabled: false,
    };
  });
  const warnings: string[] = [];
  const declared = pkg.manifest.license;
  if (!declared && !licenseFile) warnings.push('LICENSE_MISSING');
  else if (!declared && licenseFile) warnings.push('LICENSE_UNDECLARED');
  if (files.some((file) => file.executable)) warnings.push('EXECUTABLES_PRESENT');
  if (files.some((file) => file.network)) warnings.push('NETWORK_REFERENCES_PRESENT');
  return {
    trustLevel: 'external',
    files,
    hooks: files.filter((file) => file.component === 'hooks').map((file) => file.path),
    mcpConfig: files.find((file) => file.component === 'mcp')?.path ?? null,
    executableFiles: files.filter((file) => file.executable).map((file) => file.path),
    networkFiles: files.filter((file) => file.network).map((file) => file.path),
    license: { ...(declared ? { declared } : {}), ...(licenseFile ? { file: licenseFile } : {}) },
    warnings,
  };
}

function assertAllowed(
  report: PluginSecurityReport,
  requested: PluginComponent[],
  request: PluginActivationRequest,
): void {
  const unique = Array.from(new Set(requested));
  for (const component of unique) {
    if (component === 'hooks' && !request.allowHooks) {
      throw new PluginSecurityError('ACTIVATION_DENIED', 'hooks require explicit allowHooks=true');
    }
    if (component === 'mcp' && !request.allowMcp) {
      throw new PluginSecurityError('ACTIVATION_DENIED', '.mcp.json requires explicit allowMcp=true');
    }
    const files = report.files.filter((file) => file.component === component);
    if (files.some((file) => file.executable) && !request.allowScripts) {
      throw new PluginSecurityError(
        'ACTIVATION_DENIED',
        `component ${component} contains scripts; pass allowScripts=true`,
      );
    }
  }
  if (request.allowNetwork && report.networkFiles.length > 0 && !request.allowNetwork) {
    throw new PluginSecurityError('NETWORK_NOT_ALLOWED', 'network use was not requested');
  }
}

/**
 * Resolve what a caller may actually use. Defaults are deny: no component, no script, no hook, no
 * `.mcp.json`, no network. Every grant is a named boolean, not a side effect of importing.
 */
export function activatePluginPackage(
  pkg: PluginPackage,
  request: PluginActivationRequest = {},
): PluginActivation {
  const report = inspectPluginSecurity(pkg);
  const requested = request.enableComponents ?? [];
  const unique = Array.from(new Set(requested));
  assertAllowed(report, unique, request);
  const enabledFiles = report.files
    .filter((file) => unique.includes(file.component))
    .filter((file) => !file.executable || request.allowScripts === true)
    .map((file) => file.path);
  return {
    enabledComponents: unique,
    enabledFiles,
    networkEnabled: request.allowNetwork === true && report.networkFiles.length > 0,
    report,
  };
}

/** Convenience: find the license file path without activating anything. */
export function pluginLicenseFile(pkg: PluginPackage): string | null {
  return inspectPluginSecurity(pkg).license.file ?? null;
}

export function pluginLicenseWarning(report: PluginSecurityReport): string | null {
  if (report.warnings.includes('LICENSE_MISSING')) {
    return 'Plugin has no declared license and no LICENSE/COPYING file; treat it as unlicensed.';
  }
  if (report.warnings.includes('LICENSE_UNDECLARED')) {
    return 'Plugin ships a license file but plugin.json does not declare `license`.';
  }
  return null;
}

// Keep the path import used on platforms where `path` is needed for future license scanning.
void path;
