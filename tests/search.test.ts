import { describe, it, expect, beforeEach } from 'vitest';
import type { KnowledgeDoc, Task } from '../src/types.js';
import {
  searchBM25Only,
  hybridSearch,
  buildTextForTask,
  buildTextForDoc,
  chunkText,
  buildChunksForDoc,
  twoStageHybridKnowledgeSearch,
  type VectorSearchAdapter
} from '../src/search/index.js';

describe('search module', () => {
  describe('searchBM25Only', () => {
    it('returns empty array for empty items', async () => {
      const results = await searchBM25Only('test', []);
      expect(results).toEqual([]);
    });

    it('returns empty array for empty query', async () => {
      const items = [{ id: '1', text: 'test content', item: { id: '1' } }];
      const results = await searchBM25Only('', items);
      expect(results).toEqual([]);
    });

    it('finds exact matches with high score', async () => {
      const items = [
        { id: '1', text: 'hello world', item: { id: '1' } },
        { id: '2', text: 'goodbye world', item: { id: '2' } }
      ];
      const results = await searchBM25Only('hello', items);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('1');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('respects limit parameter', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        text: `test content ${i}`,
        item: { id: `${i}` }
      }));
      const results = await searchBM25Only('test', items, 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('ranks relevant results higher', async () => {
      const items = [
        { id: '1', text: 'machine learning algorithms', item: { id: '1' } },
        { id: '2', text: 'simple test case', item: { id: '2' } },
        { id: '3', text: 'machine learning is great', item: { id: '3' } }
      ];
      const results = await searchBM25Only('machine learning', items);
      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  describe('hybridSearch', () => {
    it('falls back to BM25 when no vector adapter', async () => {
      const items = [{ id: '1', text: 'test content', item: { id: '1' } }];
      const results = await hybridSearch('test', items);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('1');
    });

    it('merges BM25 and vector results', async () => {
      const mockAdapter: VectorSearchAdapter<any> = {
        search: async (query: string, items: any[]) => [
          { id: '1', score: 0.9, item: items[0].item },
          { id: '2', score: 0.8, item: items[1].item }
        ]
      };

      const items = [
        { id: '1', text: 'vector match', item: { id: '1' } },
        { id: '2', text: 'bm25 match', item: { id: '2' } }
      ];

      const results = await hybridSearch('query', items, { vectorAdapter: mockAdapter });
      expect(results.length).toBe(2);
      expect(results[0].score).toBe(0.9); // Vector result should win
    });

    it('handles vector adapter errors gracefully', async () => {
      const mockAdapter: VectorSearchAdapter<any> = {
        search: async () => { throw new Error('Vector search failed'); }
      };

      const items = [{ id: '1', text: 'test content', item: { id: '1' } }];
      const results = await hybridSearch('test', items, { vectorAdapter: mockAdapter });
      expect(results.length).toBe(1); // Should fall back to BM25
    });
  });

  describe('buildTextForTask', () => {
    it('builds text from task fields', () => {
      const task: Task = {
        id: '1',
        project: 'test',
        title: 'Test Task',
        description: 'Task description',
        status: 'pending',
        priority: 'high',
        tags: ['tag1', 'tag2'],
        links: ['link1', 'link2'],
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const text = buildTextForTask(task);
      expect(text).toContain('Test Task');
      expect(text).toContain('Task description');
      expect(text).toContain('tag1 tag2');
      expect(text).toContain('link1 link2');
      expect(text).toContain('pending');
      expect(text).toContain('high');
    });

    it('handles missing optional fields', () => {
      const task: Task = {
        id: '1',
        project: 'test',
        title: 'Test Task',
        status: 'pending',
        priority: 'high',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const text = buildTextForTask(task);
      expect(text).toContain('Test Task');
      expect(text).toContain('pending');
      expect(text).toContain('high');
    });
  });

  describe('buildTextForDoc', () => {
    it('builds text from document fields', () => {
      const doc: KnowledgeDoc = {
        id: '1',
        project: 'test',
        title: 'Test Document',
        content: 'Document content',
        tags: ['tag1', 'tag2'],
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const text = buildTextForDoc(doc);
      expect(text).toContain('Test Document');
      expect(text).toContain('tag1 tag2');
      expect(text).toContain('Document content');
    });

    it('handles missing tags', () => {
      const doc: KnowledgeDoc = {
        id: '1',
        project: 'test',
        title: 'Test Document',
        content: 'Document content',
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const text = buildTextForDoc(doc);
      expect(text).toContain('Test Document');
      expect(text).toContain('Document content');
    });
  });

  describe('chunkText', () => {
    it('returns single chunk for short text', () => {
      const text = 'Short text';
      const chunks = chunkText(text, { chunkSize: 100 });
      expect(chunks).toEqual(['Short text']);
    });

    it('splits long text into chunks', () => {
      const text = 'A'.repeat(100);
      const chunks = chunkText(text, { chunkSize: 30, chunkOverlap: 5 });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBe(30);
      expect(chunks[1].length).toBe(30);
    });

    it('respects chunk overlap', () => {
      const text = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const chunks = chunkText(text, { chunkSize: 10, chunkOverlap: 3 });
      expect(chunks.length).toBeGreaterThan(1);
      // Check that overlap is preserved
      const overlap = chunks[0].slice(-3);
      expect(chunks[1].startsWith(overlap)).toBe(true);
    });

    it('handles edge cases', () => {
      expect(chunkText('', { chunkSize: 10 })).toEqual(['']);
      expect(chunkText('test', { chunkSize: 1 })).toEqual(['t', 'e', 's', 't']);
    });
  });

  describe('buildChunksForDoc', () => {
    it('returns single chunk for small documents', () => {
      const doc: KnowledgeDoc = {
        id: '1',
        project: 'test',
        title: 'Test',
        content: 'Short content',
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const chunks = buildChunksForDoc(doc);
      expect(chunks.length).toBe(1);
      expect(chunks[0].id).toBe('1#0');
      expect(chunks[0].text).toContain('Test');
      expect(chunks[0].item.doc).toBe(doc);
      expect(chunks[0].item.chunkIndex).toBe(0);
    });

    it('creates multiple chunks for large documents', () => {
      const doc: KnowledgeDoc = {
        id: '1',
        project: 'test',
        title: 'Test',
        content: 'A'.repeat(1000),
        tags: ['tag1'],
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const chunks = buildChunksForDoc(doc, { chunkSize: 100, chunkOverlap: 10 });
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, index) => {
        expect(chunk.id).toBe(`1#${index}`);
        expect(chunk.item.chunkIndex).toBe(index);
        expect(chunk.item.doc).toBe(doc);
        expect(chunk.text).toContain('Test');
        expect(chunk.text).toContain('tag1');
      });
    });
  });

  describe('twoStageHybridKnowledgeSearch', () => {
    it('performs two-stage search correctly', async () => {
      const docs: KnowledgeDoc[] = [
        {
          id: '1',
          project: 'test',
          title: 'First Document',
          content: 'This document contains relevant information about machine learning',
          tags: ['ml'],
          source: 'test',
          type: 'note',
          archived: false,
          trashed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: '2',
          project: 'test',
          title: 'Second Document',
          content: 'This is about web development and has some machine learning mentions',
          tags: ['web'],
          source: 'test',
          type: 'note',
          archived: false,
          trashed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const results = await twoStageHybridKnowledgeSearch('machine learning', docs);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBeDefined();
      expect(typeof results[0].score).toBe('number');
    });

    it('respects prefilter and final limits', async () => {
      const docs = Array.from({ length: 50 }, (_, i) => ({
        id: `${i}`,
        project: 'test',
        title: `Document ${i}`,
        content: `Content ${i} with searchable terms`,
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));

      const results = await twoStageHybridKnowledgeSearch('searchable', docs, {
        prefilterLimit: 5,
        limit: 3
      });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('handles empty document list', async () => {
      const results = await twoStageHybridKnowledgeSearch('query', []);
      expect(results).toEqual([]);
    });

    it('works with vector adapter in second stage', async () => {
      const mockAdapter: VectorSearchAdapter<any> = {
        search: async (query: string, items: any[]) => [
          { id: '1#0', score: 0.9, item: { doc: { id: '1' }, chunkIndex: 0 } }
        ]
      };

      const docs: KnowledgeDoc[] = [{
        id: '1',
        project: 'test',
        title: 'Test',
        content: 'A'.repeat(1000),
        source: 'test',
        type: 'note',
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }];

      const results = await twoStageHybridKnowledgeSearch('test', docs, {
        vectorAdapter: mockAdapter,
        chunkSize: 100
      });

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('1');
    });
  });
});
