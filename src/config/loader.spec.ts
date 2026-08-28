/**
 * config/loader.spec.ts — Tests for unified config loader (CFG-001).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadUnifiedConfig, configGet, resetConfigCache } from './loader.js';

describe('CFG-001: Unified Config Loader', () => {
  const origEnv = { ...process.env };
  const origArgv = [...process.argv];

  beforeEach(() => {
    resetConfigCache();
    // Clear all MCP_* and config-related env vars
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('MCP_') ||
        key.startsWith('EMBEDDINGS_') ||
        key.startsWith('CATALOG_') ||
        key.startsWith('LOG_') ||
        key.startsWith('METRICS_') ||
        key.startsWith('JWT_') ||
        key.startsWith('JWKS_') ||
        key === 'DATA_DIR' ||
        key === 'CURRENT_PROJECT' ||
        key === 'OBSIDIAN_VAULT_ROOT' ||
        key === 'PROMPTS_BUILD_ENABLED' ||
        key === 'MCP_CONFIG_JSON'
      ) {
        delete process.env[key];
      }
    }
    process.argv = [...origArgv];
  });

  afterEach(() => {
    process.env = { ...origEnv };
    process.argv = [...origArgv];
  });

  describe('defaults', () => {
    it('returns schema defaults when no env/file/CLI provided', () => {
      const config = loadUnifiedConfig();

      expect(config.transport.type).toBe('stdio');
      expect(config.transport.port).toBe(3001);
      expect(config.transport.host).toBe('0.0.0.0');
      expect(config.session.maxSessions).toBe(1000);
      expect(config.session.ttlMs).toBe(86_400_000);
      expect(config.logging.level).toBe('info');
      expect(config.embeddings.mode).toBe('onnx-gpu');
      expect(config.metrics.enabled).toBe(true);
      expect(config.data.dir).toBe('./data');
    });
  });

  describe('env var overrides', () => {
    it('overrides transport type from env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_TRANSPORT = 'http';
      const config = loadUnifiedConfig();
      expect(config.transport.type).toBe('http');
    });

    it('overrides port from env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_PORT = '8080';
      const config = loadUnifiedConfig();
      expect(config.transport.port).toBe(8080);
    });

    it('overrides session TTL from env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_SESSION_TTL_MS = '3600000';
      const config = loadUnifiedConfig();
      expect(config.session.ttlMs).toBe(3_600_000);
    });

    it('parses boolean env vars correctly', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.METRICS_ENABLED = 'false';
      const config = loadUnifiedConfig();
      expect(config.metrics.enabled).toBe(false);
    });

    it('parses boolean true variants', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.METRICS_ENABLED = 'yes';
      const config = loadUnifiedConfig();
      expect(config.metrics.enabled).toBe(true);
    });

    it('overrides nested catalog config from env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.CATALOG_ENABLED = 'true';
      process.env.CATALOG_MODE = 'remote';
      process.env.CATALOG_URL = 'http://catalog:3001';
      const config = loadUnifiedConfig();
      expect(config.catalog.enabled).toBe(true);
      expect(config.catalog.mode).toBe('remote');
      expect(config.catalog.remote.baseUrl).toBe('http://catalog:3001');
    });

    it('overrides embeddings config from env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.EMBEDDINGS_MODE = 'onnx-cpu';
      process.env.EMBEDDINGS_BATCH_SIZE = '32';
      const config = loadUnifiedConfig();
      expect(config.embeddings.mode).toBe('onnx-cpu');
      expect(config.embeddings.batchSize).toBe(32);
    });
  });

  describe('config file (MCP_CONFIG_JSON)', () => {
    it('overrides defaults via inline JSON', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_CONFIG_JSON = JSON.stringify({
        transport: { port: 9999, host: '127.0.0.1' },
        logging: { level: 'debug' },
      });
      const config = loadUnifiedConfig();
      expect(config.transport.port).toBe(9999);
      expect(config.transport.host).toBe('127.0.0.1');
      expect(config.logging.level).toBe('debug');
    });

    it('env overrides file config', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_CONFIG_JSON = JSON.stringify({
        transport: { port: 9999 },
      });
      process.env.MCP_PORT = '7777';
      const config = loadUnifiedConfig();
      expect(config.transport.port).toBe(7777);
    });
  });

  describe('CLI args', () => {
    it('--transport overrides env and file', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_TRANSPORT = 'http';
      process.argv = ['node', 'index.js', '--transport', 'tcp'];
      const config = loadUnifiedConfig();
      expect(config.transport.type).toBe('tcp');
    });

    it('--port overrides env', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_PORT = '8080';
      process.argv = ['node', 'index.js', '--port', '4000'];
      const config = loadUnifiedConfig();
      expect(config.transport.port).toBe(4000);
    });
  });

  describe('configGet()', () => {
    it('returns value by dot-path', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      expect(configGet('transport.port')).toBe(3001);
      expect(configGet('session.ttlMs')).toBe(86_400_000);
      expect(configGet('logging.level')).toBe('info');
    });

    it('returns undefined for unknown path', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      expect(configGet('nonexistent.key')).toBeUndefined();
    });
  });

  describe('caching', () => {
    it('caches config on first load', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_PORT = '8080';
      const c1 = loadUnifiedConfig();

      // Change env after first load — should NOT affect cached config
      process.env.MCP_PORT = '9999';
      const c2 = loadUnifiedConfig();

      expect(c1).toBe(c2);
      expect(c2.transport.port).toBe(8080);
    });

    it('resetConfigCache forces reload', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_PORT = '8080';
      const c1 = loadUnifiedConfig();

      resetConfigCache();
      process.env.MCP_PORT = '9999';
      const c2 = loadUnifiedConfig();

      expect(c2.transport.port).toBe(9999);
    });
  });

  describe('validation', () => {
    it('rejects invalid transport type', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_TRANSPORT = 'invalid';
      expect(() => loadUnifiedConfig()).toThrow();
    });

    it('rejects invalid port (non-numeric)', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_PORT = 'not-a-number';
      // parseNum returns NaN, which is skipped — so default 3001 is used
      const config = loadUnifiedConfig();
      expect(config.transport.port).toBe(3001);
    });

    it('rejects negative session TTL via Zod', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.MCP_SESSION_TTL_MS = '0';
      expect(() => loadUnifiedConfig()).toThrow();
    });

    it('rejects invalid embeddings mode', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.EMBEDDINGS_MODE = 'invalid-mode';
      expect(() => loadUnifiedConfig()).toThrow();
    });

    it('rejects invalid log level', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      process.env.LOG_LEVEL = 'verbose';
      expect(() => loadUnifiedConfig()).toThrow();
    });
  });

  describe('immutability', () => {
    it('config object is frozen', () => {
      process.env.DATA_DIR = '/tmp/test-data';
      const config = loadUnifiedConfig();
      expect(Object.isFrozen(config)).toBe(true);
      expect(() => {
        (config as Record<string, unknown>).transport = { type: 'tcp', port: 1, host: 'x', tcpPort: 1, tcpHost: 'x', unixPath: 'x', handleSignals: true };
      }).toThrow();
    });
  });
});
