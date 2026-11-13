#!/usr/bin/env node
/**
 * DX-27: validate the official MCP registry manifest (`server.json`) without
 * publishing it. Network access is not required; the schema URL is checked
 * statically and the npm identity is cross-checked against package.json.
 */
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[a-z0-9.-]+\/[a-z0-9._-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SCHEMAS = new Set([
  'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
]);

export function validateManifest(manifest, pkg) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  if (!SCHEMAS.has(manifest.$schema)) push('$schema must be the 2025-12-11 server schema');
  if (typeof manifest.name !== 'string' || !NAME_RE.test(manifest.name)) {
    push('name must look like io.github.<owner>/<server>');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    push('description is required');
  } else if (manifest.description.length > 100) {
    push(`description must be <= 100 chars (got ${manifest.description.length})`);
  }
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    push('version must be semver');
  }
  if (manifest.version !== pkg?.version) push(`version ${manifest.version} != package.json ${pkg?.version}`);
  if (typeof pkg?.mcpName !== 'string' || pkg.mcpName !== manifest.name) {
    push('package.json mcpName must equal server.json name');
  }
  if (manifest.repository?.source !== 'github' || !/^https:\/\/github\.com\//.test(manifest.repository?.url ?? '')) {
    push('repository.source=github and an https GitHub URL are required');
  }

  const packages = manifest.packages;
  if (!Array.isArray(packages) || packages.length !== 1) {
    push('exactly one package is supported by this manifest');
  } else {
    const p = packages[0];
    if (p.registryType !== 'npm') push('package.registryType must be npm');
    if (p.identifier !== pkg?.name) push(`package.identifier ${p.identifier} != package.json ${pkg?.name}`);
    if (p.version !== manifest.version) push('package.version must match manifest.version');
    if (p.transport?.type !== 'stdio') push('package.transport.type must be stdio');
  }
  return errors;
}

function main() {
  const root = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.resolve(root, 'server.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8'));
  const errors = validateManifest(manifest, pkg);
  if (errors.length) {
    console.error('server.json invalid:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('server.json OK');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', ''))) {
  main();
}
