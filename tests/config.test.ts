import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

// We'll dynamically import the config module inside tests after setting env
let cfg: any;

describe('config module', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = path.join(process.cwd(), '.tmp-config-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    // Reset environment
    process.env = { ...originalEnv };
    process.env.DATA_DIR = tempDir;
    process.env.OBSIDIAN_VAULT_ROOT = path.join(tempDir, 'vault');

    // Ensure fresh module state per-test
    vi.resetModules();
    // Note: actual dynamic import happens inside each test to avoid preloading side effects

    // Clean up any existing state file
    const stateFile = path.join(tempDir, '.state.json');
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
    }
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('loadConfig', () => {
    it('returns default configuration when no env vars set', () => {
      // Import after env prepared
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();

        expect(config).toHaveProperty('embeddings');
        expect(config).toHaveProperty('obsidian');
        expect(config.obsidian.vaultRoot).toBe(path.join(tempDir, 'vault'));
      });
    });

    it('respects environment variables', () => {
      process.env.EMBEDDINGS_MODE = 'none';
      process.env.OBSIDIAN_VAULT_ROOT = '/custom/vault/path';

      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();

        expect(config.embeddings.mode).toBe('none');
        expect(config.obsidian.vaultRoot).toBe('/custom/vault/path');
      });
    });

    it('loads configuration from JSON string', () => {
      process.env.MCP_CONFIG_JSON = JSON.stringify({
        embeddings: { mode: 'onnx-cpu' },
        obsidian: { vaultRoot: '/json/vault' }
      });

      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();
        expect(config.embeddings.mode).toBe('onnx-cpu');
        expect(config.obsidian.vaultRoot).toBe('/json/vault');
      });
    });

    it('falls back to none mode when embeddings config is missing', () => {
      process.env.EMBEDDINGS_MODE = 'onnx-cpu';
      // Don't set model path or dim
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();
        expect(config.embeddings.mode).toBe('none');
      });
    });

    it('parses numeric environment variables', () => {
      process.env.EMBEDDINGS_DIM = '384';
      process.env.EMBEDDINGS_BATCH_SIZE = '8';
      process.env.EMBEDDINGS_MAX_LEN = '128';
      process.env.EMBEDDINGS_MEM_LIMIT_MB = '64';

      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();
        expect(config.embeddings.dim).toBe(384);
        expect(config.embeddings.batchSize).toBe(8);
        expect(config.embeddings.maxLen).toBe(128);
        expect(config.embeddings.cacheMemLimitMB).toBe(64);
      });
    });

    it('parses boolean environment variables', () => {
      process.env.EMBEDDINGS_PERSIST = 'true';
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();
        expect(config.embeddings.persist).toBe(true);
      });
    });
  });

  describe('loadCatalogConfig', () => {
    it('returns default catalog configuration', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadCatalogConfig();
        expect(config).toHaveProperty('mode');
        expect(config).toHaveProperty('prefer');
        expect(config).toHaveProperty('embedded');
        expect(config).toHaveProperty('remote');
        expect(config).toHaveProperty('sync');
      });
    });

    it('respects catalog environment variables', () => {
      process.env.CATALOG_MODE = 'remote';
      process.env.CATALOG_URL = 'http://example.com';
      process.env.CATALOG_REMOTE_ENABLED = 'true';
      process.env.CATALOG_EMBEDDED_ENABLED = 'false';
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadCatalogConfig();
        expect(config.mode).toBe('remote');
        expect(config.remote.enabled).toBe(true);
        expect(config.remote.baseUrl).toBe('http://example.com');
      });
    });

    it('parses numeric catalog values', () => {
      process.env.CATALOG_REMOTE_TIMEOUT_MS = '5000';
      process.env.CATALOG_SYNC_INTERVAL_SEC = '120';
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadCatalogConfig();
        expect(config.remote.timeoutMs).toBe(5000);
        expect(config.sync.intervalSec).toBe(120);
      });
    });

    it('falls back to embedded mode when remote URL is missing', () => {
      process.env.CATALOG_MODE = 'remote';
      process.env.CATALOG_REMOTE_ENABLED = 'true';
      // Don't set remote URL
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadCatalogConfig();
        expect(config.mode).toBe('embedded');
        expect(config.embedded.enabled).toBe(true);
      });
    });
  });

  describe('project management', () => {
    it('returns default project when no project is set', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        const project = cfg.getCurrentProject();
        expect(project).toBe(cfg.DEFAULT_PROJECT);
      });
    });

    it('sets and gets current project', () => {
      const newProject = 'test-project';
      return import('../src/config.js').then((m) => {
        cfg = m;
        cfg.setCurrentProject(newProject);
        const current = cfg.getCurrentProject();
        expect(current).toBe(newProject);
      });
    });

    it('persists project to state file', () => {
      const newProject = 'persisted-project';
      return import('../src/config.js').then((m) => {
        cfg = m;
        cfg.setCurrentProject(newProject);
        const stateFile = path.join(tempDir, '.state.json');
        expect(fs.existsSync(stateFile)).toBe(true);
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        expect(state.currentProject).toBe(newProject);
        expect(state.updatedAt).toBeDefined();
      });
    });

    it('loads persisted project on next getCurrentProject call', () => {
      // Simulate persisted state
      const stateFile = path.join(tempDir, '.state.json');
      const persistedState = {
        currentProject: 'loaded-project',
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(stateFile, JSON.stringify(persistedState));
      const newProject = 'new-project';
      return import('../src/config.js').then((m) => {
        cfg = m;
        cfg.setCurrentProject(newProject);
        const updatedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        expect(updatedState.currentProject).toBe(newProject);
      });
    });

    it('resolves project correctly', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        cfg.setCurrentProject('custom-project');
        expect(cfg.resolveProject()).toBe('custom-project');
        expect(cfg.resolveProject('explicit-project')).toBe('explicit-project');
        expect(cfg.resolveProject('')).toBe('custom-project');
      });
    });

    it('handles empty or whitespace project names', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        cfg.setCurrentProject('   '); // whitespace only
        expect(cfg.getCurrentProject()).toBe('   ');
        cfg.setCurrentProject(''); // empty string
        expect(cfg.getCurrentProject()).toBe('');
      });
    });
  });

  describe('catalog access flags', () => {
    it('returns false for catalog enabled by default', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogEnabled()).toBe(false);
      });
    });

    it('returns true when catalog is enabled via env', () => {
      process.env.CATALOG_ENABLED = 'true';
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogEnabled()).toBe(true);
        process.env.CATALOG_ENABLED = '1';
        expect(cfg.isCatalogEnabled()).toBe(true);
        process.env.CATALOG_ENABLED = 'yes';
        expect(cfg.isCatalogEnabled()).toBe(true);
      });
    });

    it('returns false for read/write when catalog is disabled', () => {
      process.env.CATALOG_ENABLED = 'false';
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogReadEnabled()).toBe(false);
        expect(cfg.isCatalogWriteEnabled()).toBe(false);
      });
    });

    it('returns true for read when catalog is enabled', () => {
      process.env.CATALOG_ENABLED = 'true';
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogReadEnabled()).toBe(true);
      });
    });

    it('returns false for write by default when catalog is enabled', () => {
      process.env.CATALOG_ENABLED = 'true';
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogWriteEnabled()).toBe(false);
      });
    });

    it('returns true for write when explicitly enabled', () => {
      process.env.CATALOG_ENABLED = 'true';
      process.env.CATALOG_WRITE_ENABLED = 'true';
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.isCatalogWriteEnabled()).toBe(true);
      });
    });
  });

  describe('directory constants', () => {
    it('exports correct directory paths', () => {
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.DATA_DIR).toBe(tempDir);
        expect(cfg.TASKS_DIR).toContain(path.join(tempDir, 'tasks'));
        expect(cfg.KNOWLEDGE_DIR).toContain(path.join(tempDir, 'knowledge'));
        expect(cfg.PROMPTS_DIR).toContain(path.join(tempDir, 'prompts'));
        expect(cfg.EMBEDDINGS_DIR).toBe(path.join(tempDir, '.embeddings'));
      });
    });

    it('respects environment overrides for directories', () => {
      const customTaskDir = '/custom/tasks';
      const customKnowledgeDir = '/custom/knowledge';
      const customPromptsDir = '/custom/prompts';

      process.env.MCP_TASK_DIR = customTaskDir;
      process.env.MCP_KNOWLEDGE_DIR = customKnowledgeDir;
      process.env.MCP_PROMPTS_DIR = customPromptsDir;
      vi.resetModules();
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(cfg.TASKS_DIR).toBe(customTaskDir);
        expect(cfg.KNOWLEDGE_DIR).toBe(customKnowledgeDir);
        expect(cfg.PROMPTS_DIR).toBe(customPromptsDir);
      });
    });
  });

  describe('error handling', () => {
    it('throws error when DATA_DIR is not set', () => {
      delete process.env.DATA_DIR;
      vi.resetModules();
      return import('../src/config.js')
        .then(() => {
          // Should not reach here when DATA_DIR missing
          expect(true).toBe(false);
        })
        .catch((e) => {
          expect(String(e.message || e)).toContain('DATA_DIR');
        });
    });

    it('handles malformed JSON in MCP_CONFIG_JSON gracefully', () => {
      process.env.MCP_CONFIG_JSON = 'invalid json';
      return import('../src/config.js').then((m) => {
        cfg = m;
        const config = cfg.loadConfig();
        expect(config).toBeDefined();
        expect(config.obsidian.vaultRoot).toBe(path.join(tempDir, 'vault'));
      });
    });

    it('handles missing state file gracefully', () => {
      const nonExistentStateFile = path.join(tempDir, 'nonexistent.json');
      return import('../src/config.js').then((m) => {
        cfg = m;
        expect(() => cfg.getCurrentProject()).not.toThrow();
      });
    });
  });
});
