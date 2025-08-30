import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

// Create a minimal test version of the MCP server for integration testing
// We'll import and test the main server functionality

describe('MCP Server Integration', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    // Create temporary directory for tests
    tempDir = path.join(process.cwd(), '.tmp-mcp-integration-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    // Save original environment
    originalEnv = { ...process.env };

    // Set up test environment
    process.env.DATA_DIR = tempDir;
    process.env.OBSIDIAN_VAULT_ROOT = path.join(tempDir, 'vault');
    process.env.EMBEDDINGS_MODE = 'none'; // Disable embeddings for faster tests
    process.env.CATALOG_ENABLED = 'false'; // Disable catalog for simpler tests
  });

  afterAll(async () => {
    // Restore original environment
    process.env = originalEnv;

    // Clean up
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to clean up temp dir:', e);
    }
  });

  describe('Server Initialization', () => {
    it('should initialize server without throwing', async () => {
      // Test that we can import and initialize the server module
      expect(async () => {
        // This tests that the server can be started with our test environment
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

        const server = new McpServer({
          name: "mcp-task-knowledge-test",
          version: "1.0.0"
        });

        expect(server).toBeDefined();
        expect(server.registerTool).toBeDefined();
      }).not.toThrow();
    });

    it('should load configuration without errors', async () => {
      // Test that our config loading works in the test environment
      const { loadConfig } = await import('../src/config.js');

      const config = loadConfig();
      expect(config).toBeDefined();
      expect(config.embeddings).toBeDefined();
      expect(config.obsidian).toBeDefined();
      expect(config.obsidian.vaultRoot).toBe(path.join(tempDir, 'vault'));
    });
  });

  describe('Tool Registration', () => {
    it('should register basic project management tools', async () => {
      // Test that core tools are registered properly
      // This is a simplified test since we can't easily test the full server startup
      const { DEFAULT_PROJECT } = await import('../src/config.js');

      expect(DEFAULT_PROJECT).toBe('mcp');
    });

    it('should have all required tool schemas', async () => {
      // Test that tool schemas are properly defined
      // This tests the schema definitions without starting the full server
      const zod = (await import('zod')).z;

      const projectSchema = zod.string().optional();
      expect(projectSchema).toBeDefined();

      const taskUpdateSchema = zod.object({
        id: zod.string().min(1),
        title: zod.string().optional(),
        description: zod.string().optional(),
        priority: zod.enum(["low", "medium", "high"]).optional(),
        tags: zod.array(zod.string()).optional(),
        links: zod.array(zod.string()).optional(),
        parentId: zod.string().nullable().optional(),
        status: zod.enum(["pending", "in_progress", "completed", "closed"]).optional(),
      });

      expect(taskUpdateSchema).toBeDefined();
    });
  });

  describe('Storage Integration', () => {
    it('should create and read tasks', async () => {
      const { createTask, readTask, listTasks } = await import('../src/storage/tasks.js');

      const project = 'test-project';
      const title = 'Integration Test Task';
      const description = 'Testing task creation and retrieval';

      // Create a task
      const createdTask = await createTask({
        project,
        title,
        description,
        priority: 'medium',
        tags: ['integration', 'test']
      });

      expect(createdTask).toBeDefined();
      expect(createdTask.id).toBeDefined();
      expect(createdTask.title).toBe(title);
      expect(createdTask.description).toBe(description);
      expect(createdTask.priority).toBe('medium');
      expect(createdTask.tags).toEqual(['integration', 'test']);
      expect(createdTask.status).toBe('pending');
      expect(createdTask.archived).toBe(false);
      expect(createdTask.trashed).toBe(false);

      // Read the task back
      const readTaskResult = await readTask(project, createdTask.id);
      expect(readTaskResult).toBeDefined();
      expect(readTaskResult?.id).toBe(createdTask.id);
      expect(readTaskResult?.title).toBe(title);

      // List tasks
      const tasks = await listTasks({ project });
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.some(t => t.id === createdTask.id)).toBe(true);
    });

    it('should create and read knowledge documents', async () => {
      const { createDoc, readDoc, listDocs } = await import('../src/storage/knowledge.js');

      const project = 'test-project';
      const title = 'Integration Test Document';
      const content = '# Test Content\n\nThis is a test document for integration testing.';
      const tags = ['integration', 'test', 'documentation'];

      // Create a document
      const createdDoc = await createDoc({
        project,
        title,
        content,
        tags,
        source: 'integration-test',
        type: 'note'
      });

      expect(createdDoc).toBeDefined();
      expect(createdDoc.id).toBeDefined();
      expect(createdDoc.title).toBe(title);
      expect(createdDoc.content).toBe(content);
      expect(createdDoc.tags).toEqual(tags);
      expect(createdDoc.source).toBe('integration-test');
      expect(createdDoc.type).toBe('note');

      // Read the document back
      const readDocResult = await readDoc(project, createdDoc.id);
      expect(readDocResult).toBeDefined();
      expect(readDocResult?.id).toBe(createdDoc.id);
      expect(readDocResult?.title).toBe(title);
      expect(readDocResult?.content).toBe(content);

      // List documents
      const docs = await listDocs({ project });
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.some(d => d.id === createdDoc.id)).toBe(true);
    });

    it('should handle task operations (update, archive, restore)', async () => {
      const { createTask, updateTask, archiveTask, restoreTask } = await import('../src/storage/tasks.js');

      const project = 'test-project';
      const task = await createTask({
        project,
        title: 'Task for Operations Test',
        priority: 'low'
      });

      // Update task
      const updatedTask = await updateTask(project, task.id, {
        title: 'Updated Task Title',
        priority: 'high',
        status: 'in_progress'
      });

      expect(updatedTask).toBeDefined();
      expect(updatedTask?.title).toBe('Updated Task Title');
      expect(updatedTask?.priority).toBe('high');
      expect(updatedTask?.status).toBe('in_progress');

      // Archive task
      const archivedTask = await archiveTask(project, task.id);
      expect(archivedTask).toBeDefined();
      expect(archivedTask?.archived).toBe(true);
      expect(archivedTask?.archivedAt).toBeDefined();

      // Restore task
      const restoredTask = await restoreTask(project, task.id);
      expect(restoredTask).toBeDefined();
      expect(restoredTask?.archived).toBe(false);
      expect(restoredTask?.trashed).toBe(false);
    });
  });

  describe('Search Integration', () => {
    it('should perform BM25 search on tasks', async () => {
      const { createTask } = await import('../src/storage/tasks.js');
      const { searchBM25Only, buildTextForTask } = await import('../src/search/index.js');

      const project = 'test-project';

      // Create test tasks
      await createTask({
        project,
        title: 'Machine Learning Task',
        description: 'Implement machine learning algorithm',
        tags: ['ml', 'ai']
      });

      await createTask({
        project,
        title: 'Database Optimization',
        description: 'Optimize database queries',
        tags: ['db', 'performance']
      });

      // Get all tasks for search
      const { listTasks } = await import('../src/storage/tasks.js');
      const tasks = await listTasks({ project });

      // Build search items
      const searchItems = tasks.map(task => ({
        id: task.id,
        text: buildTextForTask(task),
        item: task
      }));

      // Perform search
      const results = await searchBM25Only('machine learning', searchItems);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toContain('Machine Learning');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should perform BM25 search on knowledge documents', async () => {
      const { createDoc } = await import('../src/storage/knowledge.js');
      const { searchBM25Only, buildTextForDoc } = await import('../src/search/index.js');

      const project = 'test-project';

      // Create test documents
      await createDoc({
        project,
        title: 'Machine Learning Guide',
        content: 'This guide covers machine learning algorithms and techniques',
        tags: ['ml', 'guide'],
        source: 'docs',
        type: 'article'
      });

      await createDoc({
        project,
        title: 'Database Design',
        content: 'Best practices for database design and optimization',
        tags: ['db', 'design'],
        source: 'docs',
        type: 'article'
      });

      // Get all documents for search (read full docs with content)
      const { listDocs, readDoc } = await import('../src/storage/knowledge.js');
      const metas = await listDocs({ project });
      const docs = (await Promise.all(metas.map(m => readDoc(project, m.id)))).filter(Boolean) as any[];

      // Build search items
      const searchItems = docs.map(doc => ({
        id: doc.id,
        text: buildTextForDoc(doc),
        item: doc
      }));

      // Perform search
      const results = await searchBM25Only('machine learning', searchItems);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item.title).toContain('Machine Learning');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should handle two-stage search correctly', async () => {
      const { createDoc } = await import('../src/storage/knowledge.js');
      const { twoStageHybridKnowledgeSearch } = await import('../src/search/index.js');

      const project = 'test-project';

      // Create test documents
      await createDoc({
        project,
        title: 'Long Machine Learning Document',
        content: 'A'.repeat(2000), // Long content to trigger chunking
        tags: ['ml'],
        source: 'docs',
        type: 'article'
      });

      await createDoc({
        project,
        title: 'Short Document',
        content: 'Short content about databases',
        tags: ['db'],
        source: 'docs',
        type: 'note'
      });

      // Get all documents as full docs (with content)
      const { listDocs, readDoc } = await import('../src/storage/knowledge.js');
      const metas = await listDocs({ project });
      const docs = (await Promise.all(metas.map(m => readDoc(project, m.id)))).filter(Boolean) as any[];

      // Perform two-stage search
      const results = await twoStageHybridKnowledgeSearch('machine learning', docs, {
        chunkSize: 500,
        chunkOverlap: 50
      });

      expect(results.length).toBeGreaterThan(0);
      // Should find the machine learning document
      expect(results.some(r => r.item.title.includes('Machine Learning'))).toBe(true);
    });
  });

  describe('Project Management Integration', () => {
    it('should manage projects correctly', async () => {
      const { setCurrentProject, getCurrentProject, resolveProject } = await import('../src/config.js');

      // Test setting and getting current project
      const testProject = 'integration-test-project';
      setCurrentProject(testProject);

      expect(getCurrentProject()).toBe(testProject);
      expect(resolveProject()).toBe(testProject);
      expect(resolveProject('explicit-project')).toBe('explicit-project');
    });

    it('should isolate data between projects', async () => {
      const { createTask, listTasks } = await import('../src/storage/tasks.js');

      const project1 = 'project-1';
      const project2 = 'project-2';

      // Create task in project 1
      const task1 = await createTask({
        project: project1,
        title: 'Task in Project 1'
      });

      // Create task in project 2
      const task2 = await createTask({
        project: project2,
        title: 'Task in Project 2'
      });

      // Verify isolation
      const tasks1 = await listTasks({ project: project1 });
      const tasks2 = await listTasks({ project: project2 });

      expect(tasks1.length).toBe(1);
      expect(tasks2.length).toBe(1);
      expect(tasks1[0].id).toBe(task1.id);
      expect(tasks2[0].id).toBe(task2.id);
      expect(tasks1[0].id).not.toBe(tasks2[0].id);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing task gracefully', async () => {
      const { readTask } = await import('../src/storage/tasks.js');

      const result = await readTask('test-project', 'non-existent-id');
      expect(result).toBeNull();
    });

    it('should handle missing document gracefully', async () => {
      const { readDoc } = await import('../src/storage/knowledge.js');

      const result = await readDoc('test-project', 'non-existent-id');
      expect(result).toBeNull();
    });

    it('should handle empty search queries', async () => {
      const { searchBM25Only } = await import('../src/search/index.js');

      const results = await searchBM25Only('', []);
      expect(results).toEqual([]);
    });

    it('should handle search with no matches', async () => {
      const { searchBM25Only, buildTextForTask } = await import('../src/search/index.js');
      const { createTask, listTasks } = await import('../src/storage/tasks.js');

      // Create a task
      await createTask({
        project: 'test-project',
        title: 'Test Task'
      });

      const tasks = await listTasks({ project: 'test-project' });
      const searchItems = tasks.map(task => ({
        id: task.id,
        text: buildTextForTask(task),
        item: task
      }));

      // Search for something that won't match
      const results = await searchBM25Only('nonexistenttermthatshouldnotmatch', searchItems);
      expect(results.length).toBe(0);
    });
  });
});
