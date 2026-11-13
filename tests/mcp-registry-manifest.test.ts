import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../scripts/validate-server-json.mjs';

const manifest = JSON.parse(readFileSync('server.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function clone() {
  return JSON.parse(JSON.stringify(manifest));
}

describe('DX-27 MCP registry manifest', () => {
  it('accepts the checked-in manifest and npm identity', () => {
    expect(validateManifest(manifest, pkg)).toEqual([]);
  });

  it('rejects a bad name, long description and wrong schema', () => {
    const bad = clone();
    bad.name = 'mcp-task-knowledge';
    bad.description = 'x'.repeat(101);
    bad.$schema = 'https://example.com/schema.json';
    expect(validateManifest(bad, pkg)).toEqual(expect.arrayContaining([
      expect.stringContaining('name must look like'),
      expect.stringContaining('description must be <= 100'),
      expect.stringContaining('$schema must be'),
    ]));
  });

  it('rejects version/package identity drift and non-stdio transport', () => {
    const bad = clone();
    bad.version = '9.9.9';
    bad.packages[0].identifier = 'other-package';
    bad.packages[0].transport.type = 'http';
    expect(validateManifest(bad, pkg)).toEqual(expect.arrayContaining([
      expect.stringContaining('package.json'),
      expect.stringContaining('package.identifier'),
      expect.stringContaining('transport.type must be stdio'),
    ]));
  });

  it('requires package.json mcpName to match', () => {
    const badPkg = { ...pkg, mcpName: 'io.github.other/server' };
    expect(validateManifest(manifest, badPkg)).toContain('package.json mcpName must equal server.json name');
  });
});
