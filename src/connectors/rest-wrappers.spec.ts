/**
 * connectors/rest-wrappers.spec.ts — Tests for REST wrappers (INT-005)
 */

import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../registry/tool-registry.js';
import { generateOpenApiSpec, handleRestRequest } from './rest-wrappers.js';

describe('INT-005: REST wrappers', () => {
  it('generateOpenApiSpec creates paths for all tools', () => {
    const reg = new ToolRegistry();
    reg.set('tasks_list', { title: 'List Tasks', description: 'List tasks', inputSchema: { project: {} } });
    reg.set('tasks_create', { title: 'Create Task', description: 'Create a task', inputSchema: { title: {} } });

    const spec = generateOpenApiSpec(reg);
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toHaveLength(2);
    expect(spec.paths['/api/tools/tasks_list']).toBeDefined();
    expect(spec.paths['/api/tools/tasks_list'].post?.operationId).toBe('tasks_list');
    expect(spec.paths['/api/tools/tasks_list'].post?.summary).toBe('List Tasks');
  });

  it('generateOpenApiSpec includes requestBody for tools with input keys', () => {
    const reg = new ToolRegistry();
    reg.set('tasks_create', { title: 'Create', description: 'Create task', inputSchema: { title: {}, priority: {} } });
    const spec = generateOpenApiSpec(reg);
    const op = spec.paths['/api/tools/tasks_create'].post;
    expect(op?.requestBody).toBeDefined();
    expect(op?.requestBody?.content['application/json'].schema.properties).toHaveProperty('title');
    expect(op?.requestBody?.content['application/json'].schema.properties).toHaveProperty('priority');
  });

  it('handleRestRequest returns 405 for non-POST', async () => {
    const reg = new ToolRegistry();
    const result = await handleRestRequest(reg, 'GET', '/api/tools/tasks_list', {});
    expect(result.status).toBe(405);
  });

  it('handleRestRequest returns 404 for unknown path', async () => {
    const reg = new ToolRegistry();
    const result = await handleRestRequest(reg, 'POST', '/unknown', {});
    expect(result.status).toBe(404);
  });

  it('handleRestRequest returns 404 for unknown tool', async () => {
    const reg = new ToolRegistry();
    const result = await handleRestRequest(reg, 'POST', '/api/tools/nonexistent', {});
    expect(result.status).toBe(404);
    expect((result.body as { ok: boolean }).ok).toBe(false);
  });

  it('handleRestRequest invokes tool handler and returns 200', async () => {
    const reg = new ToolRegistry();
    reg.set('echo', {
      title: 'Echo',
      description: 'Echo input',
      inputSchema: {},
      handler: async (input: Record<string, unknown>) => ({ ok: true, data: input }),
    });
    const result = await handleRestRequest(reg, 'POST', '/api/tools/echo', { hello: 'world' });
    expect(result.status).toBe(200);
    expect((result.body as { data: { hello: string } }).data.hello).toBe('world');
  });

  it('handleRestRequest returns 500 on handler error', async () => {
    const reg = new ToolRegistry();
    reg.set('boom', {
      title: 'Boom',
      description: 'Always fails',
      inputSchema: {},
      handler: async () => { throw new Error('kaboom'); },
    });
    const result = await handleRestRequest(reg, 'POST', '/api/tools/boom', {});
    expect(result.status).toBe(500);
    expect((result.body as { error: { message: string } }).error.message).toBe('kaboom');
  });
});
