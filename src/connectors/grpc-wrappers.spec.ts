/**
 * connectors/grpc-wrappers.spec.ts — Tests for gRPC wrappers (INT-006)
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../registry/tool-registry.js';
import { generateProtoSpec, renderProto } from './grpc-wrappers.js';

describe('INT-006: gRPC wrappers', () => {
  it('generateProtoSpec creates methods for all tools', () => {
    const reg = new ToolRegistry();
    reg.set('tasks_list', { title: 'List', description: 'List tasks', inputSchema: { project: {} } });
    reg.set('tasks_create', { title: 'Create', description: 'Create task', inputSchema: { title: {}, priority: {} } });

    const spec = generateProtoSpec(reg);
    expect(spec.serviceName).toBe('McpTools');
    expect(spec.methods).toHaveLength(2);
    expect(spec.methods.map((m) => m.name)).toContain('tasks_list');
    expect(spec.methods.map((m) => m.name)).toContain('tasks_create');
  });

  it('generateProtoSpec creates request/response messages', () => {
    const reg = new ToolRegistry();
    reg.set('tasks_list', { title: 'L', description: 'List', inputSchema: { project: {}, status: {} } });

    const spec = generateProtoSpec(reg);
    const reqMsg = spec.messages.find((m) => m.name === 'tasks_listRequest');
    expect(reqMsg).toBeDefined();
    expect(reqMsg!.fields).toHaveLength(2);
    expect(reqMsg!.fields[0].name).toBe('project');

    const resMsg = spec.messages.find((m) => m.name === 'tasks_listResponse');
    expect(resMsg).toBeDefined();
    expect(resMsg!.fields.some((f) => f.name === 'ok')).toBe(true);
  });

  it('renderProto produces valid proto3 syntax', () => {
    const reg = new ToolRegistry();
    reg.set('echo', { title: 'Echo', description: 'Echo input', inputSchema: { text: {} } });

    const spec = generateProtoSpec(reg);
    const proto = renderProto(spec);
    expect(proto).toContain('syntax = "proto3";');
    expect(proto).toContain('package mcp.task.knowledge;');
    expect(proto).toContain('service McpTools {');
    expect(proto).toContain('rpc echo(echoRequest) returns (echoResponse);');
    expect(proto).toContain('message echoRequest {');
    expect(proto).toContain('string text = 1;');
  });

  it('renderProto handles tools with no input keys', () => {
    const reg = new ToolRegistry();
    reg.set('ping', { title: 'Ping', description: 'Ping', inputSchema: {} });

    const spec = generateProtoSpec(reg);
    const proto = renderProto(spec);
    expect(proto).toContain('rpc ping(pingRequest) returns (pingResponse);');
    const reqMsg = spec.messages.find((m) => m.name === 'pingRequest');
    expect(reqMsg!.fields).toHaveLength(0);
  });

  it('custom service name and package', () => {
    const reg = new ToolRegistry();
    reg.set('test', { title: 'T', description: 'Test', inputSchema: {} });
    const spec = generateProtoSpec(reg, 'MyService', 'com.example.api');
    expect(spec.serviceName).toBe('MyService');
    expect(spec.package).toBe('com.example.api');
    const proto = renderProto(spec);
    expect(proto).toContain('package com.example.api;');
    expect(proto).toContain('service MyService {');
  });
});
