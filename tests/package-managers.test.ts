import { describe, expect, it } from 'vitest';
import {
  generateHomebrewFormula,
  generateScoopManifest,
  validateReleaseConfig,
} from '../scripts/gen-package-managers.mjs';

const sha = (char: string) => char.repeat(64);
interface TestAsset { url: string; sha256: string }
interface TestConfig {
  version: string;
  repository: string;
  description: string;
  license: string;
  assets: Record<string, TestAsset>;
}

const config: TestConfig = {
  version: '1.2.3',
  repository: 'https://github.com/Desure85/mcp-task-knowledge',
  description: 'Task and knowledge MCP server',
  license: 'MIT',
  assets: {
    'darwin-arm64': { url: 'https://github.com/Desure85/mcp-task-knowledge/releases/download/v1.2.3/mcp-task-knowledge-darwin-arm64', sha256: sha('a') },
    'darwin-x64': { url: 'https://github.com/Desure85/mcp-task-knowledge/releases/download/v1.2.3/mcp-task-knowledge-darwin-x64', sha256: sha('b') },
    'linux-arm64': { url: 'https://github.com/Desure85/mcp-task-knowledge/releases/download/v1.2.3/mcp-task-knowledge-linux-arm64', sha256: sha('c') },
    'linux-x64': { url: 'https://github.com/Desure85/mcp-task-knowledge/releases/download/v1.2.3/mcp-task-knowledge-linux-x64', sha256: sha('d') },
    'win-x64': { url: 'https://github.com/Desure85/mcp-task-knowledge/releases/download/v1.2.3/mcp-task-knowledge-win-x64.exe', sha256: sha('e') },
  },
};

describe('DX-21 package manager generator', () => {
  it('accepts a complete release descriptor', () => {
    expect(validateReleaseConfig(config)).toEqual([]);
  });

  it('generates a Homebrew formula with all platform URLs and hashes', () => {
    const formula = generateHomebrewFormula(config);
    expect(formula).toContain('class McpTaskKnowledge < Formula');
    expect(formula).toContain('version "1.2.3"');
    expect(formula).toContain('on_macos do');
    expect(formula).toContain('on_linux do');
    expect(formula).toContain(config.assets['darwin-arm64'].url);
    expect(formula).toContain(config.assets['linux-x64'].sha256);
    expect(formula).toContain('mcp-task-knowledge --version');
  });

  it('generates a Scoop manifest with sha256-prefixed hash', () => {
    const manifest = JSON.parse(generateScoopManifest(config));
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.architecture['64bit'].url).toBe(config.assets['win-x64'].url);
    expect(manifest.architecture['64bit'].hash).toBe(`sha256:${sha('e')}`);
    expect(manifest.bin).toEqual([['mcp-task-knowledge.exe', 'mcp-task-knowledge']]);
  });

  it('rejects bad hashes, URL and missing platform pairs', () => {
    const bad = structuredClone(config);
    bad.assets['linux-arm64'].sha256 = 'not-a-hash';
    bad.assets['linux-x64'].url = 'http://insecure.example/x';
    delete bad.assets['darwin-x64'];
    expect(validateReleaseConfig(bad)).toEqual(expect.arrayContaining([
      expect.stringContaining('sha256 must be 64 lowercase hex'),
      expect.stringContaining('url must be https'),
      expect.stringContaining('darwin-arm64 and darwin-x64 must be provided together'),
    ]));
  });

  it('requires a Windows asset for Scoop and rejects unknown keys', () => {
    const bad = structuredClone(config);
    delete bad.assets['win-x64'];
    bad.assets['freebsd-x64'] = { url: 'https://example.com/x', sha256: sha('f') };
    expect(validateReleaseConfig(bad)).toEqual(expect.arrayContaining([
      'win-x64 asset is required for Scoop',
      expect.stringContaining("unknown asset key 'freebsd-x64'"),
    ]));
  });
});
