/**
 * tests/proxy-schema-parity.test.ts — MU-09 acceptance.
 *
 * The stdio bridge must publish the core's `tools/list`, `prompts/list` and
 * `resources/*` results verbatim. The previous mirror rebuilt every JSON Schema
 * into Zod and lost nested `required`, `enum`, bounds, `description`, `default`,
 * `format` and `pattern`; a live `tasks_bulk_create` with a single `title`
 * failed through the bridge while it succeeded directly.
 *
 * Revert-check (recorded in the decision file): restore `ProxyMirror` in
 * `src/proxy/shim.ts`, rebuild, run this file — the parity assertions go RED
 * (13 required paths and every keyword counter), the file tests stay GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { assertDistFresh } from './support/dist-guard.js';
import {
  spawnTrackedServer,
  terminateServer,
  terminateTrackedServers,
  getFreePort,
} from './support/server-process.js';

assertDistFresh();

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.test-tmp', 'mu09-parity');
const JWT_SECRET = 'mu09-parity-jwt-secret-32-bytes-min!';
const PASSWORD = 'mu09-parity-pass';

interface ToolLike {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

class ChildStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly stderr: string[] = [];
  private readonly buffer = new ReadBuffer();

  constructor(private readonly child: ChildProcess) {
    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      let message: JSONRPCMessage | null;
      while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
    });
    child.stderr?.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString()));
    child.once('exit', () => this.onclose?.());
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.child.stdin?.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.child.stdin?.end();
  }
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LOG_LEVEL: 'error', EMBEDDINGS_MODE: 'none' };
  delete env.DATA_DIR;
  delete env.MCP_PROXY_UPSTREAM;
  delete env.MCP_PROXY_TOKEN;
  return env;
}

function health(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForHealth(port: number, child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('core exited before becoming healthy');
    if (await health(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('core did not become healthy');
}

function login(port: number): Promise<string> {
  const body = JSON.stringify({ username: 'admin', password: PASSWORD });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/auth/login', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { token?: string; data?: { token?: string } };
            const token = parsed.token ?? parsed.data?.token;
            if (!token) reject(new Error('login response carried no token'));
            else resolve(token);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Depth-first walk over JSON Schema nodes reachable from a tool input schema. */
function walkSchema(schema: unknown, visit: (node: Record<string, unknown>, at: string[]) => void, at: string[] = []): void {
  if (typeof schema !== 'object' || schema === null) return;
  const node = schema as Record<string, unknown>;
  visit(node, at);
  const properties = node.properties;
  if (properties && typeof properties === 'object') {
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      walkSchema(child, visit, [...at, name]);
    }
  }
  if (node.items) walkSchema(node.items, visit, [...at, '[]']);
  for (const composite of ['anyOf', 'oneOf', 'allOf']) {
    const branches = node[composite];
    if (Array.isArray(branches)) branches.forEach((child, i) => walkSchema(child, visit, [...at, `${composite}[${i}]`]));
  }
}

/** Every `required` list with its path inside the schema, keyed by tool. */
function requiredPaths(tools: ToolLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tool of tools) {
    walkSchema(tool.inputSchema, (node, at) => {
      if (Array.isArray(node.required)) {
        out[`${tool.name}:${at.join('.') || '<root>'}`] = (node.required as string[]).join(',');
      }
    });
  }
  return out;
}

const CONSTRAINT_KEYWORDS = ['description', 'minLength', 'maxLength', 'default', 'minimum', 'maximum', 'enum', 'anyOf', 'oneOf', 'format', 'pattern'] as const;

function constraintCounts(tools: ToolLike[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(CONSTRAINT_KEYWORDS.map((key) => [key, 0]));
  for (const tool of tools) {
    walkSchema(tool.inputSchema, (node) => {
      for (const key of CONSTRAINT_KEYWORDS) {
        if (node[key] !== undefined) counts[key]++;
      }
    });
  }
  return counts;
}

function textResult(result: { content?: Array<{ text?: string }>; isError?: boolean }): Record<string, unknown> {
  const text = result.content?.find((part) => typeof part.text === 'string')?.text ?? '';
  return JSON.parse(text) as Record<string, unknown>;
}

describe.sequential('MU-09 bridge schema fidelity', () => {
  let core: ChildProcess;
  let corePort = 0;
  let httpClient: Client;
  let bridge: ChildProcess;
  let bridgeClient: Client;
  let coreTools: ToolLike[] = [];

  beforeAll(async () => {
    await fsp.rm(TMP, { recursive: true, force: true });
    const coreData = path.join(TMP, 'core');
    await fsp.mkdir(coreData, { recursive: true });

    corePort = await getFreePort();
    core = spawnTrackedServer(['dist/index.js'], {
      cwd: ROOT,
      env: {
        ...baseEnv(),
        DATA_DIR: coreData,
        MCP_TRANSPORT: 'http',
        MCP_HOST: '127.0.0.1',
        MCP_PORT: String(corePort),
        JWT_SECRET,
        MCP_LOGIN_USER: 'admin',
        MCP_LOGIN_PASSWORD: PASSWORD,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForHealth(corePort, core);
    const token = await login(corePort);

    httpClient = new Client({ name: 'mu09-direct', version: '1.0.0' }, { capabilities: {} });
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${corePort}/mcp`)));
    await httpClient.callTool({ name: 'mcp.authenticate', arguments: { token } });

    bridge = spawnTrackedServer(['dist/index.js', 'bridge', '--url', `http://127.0.0.1:${corePort}/mcp`], {
      cwd: ROOT,
      env: { ...baseEnv(), MCP_PROXY_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    bridgeClient = new Client({ name: 'mu09-bridge', version: '1.0.0' }, { capabilities: {} });
    await bridgeClient.connect(new ChildStdioTransport(bridge));

    coreTools = ((await httpClient.listTools()).tools ?? []) as ToolLike[];
  }, 60_000);

  afterAll(async () => {
    await Promise.allSettled([bridgeClient?.close()]);
    await Promise.allSettled([httpClient?.close()]);
    await terminateServer(bridge, 4000).catch(() => undefined);
    await terminateTrackedServers();
    await fsp.rm(TMP, { recursive: true, force: true });
  });

  it('publishes every core tool with an identical schema (required on all levels)', async () => {
    const bridgeTools = ((await bridgeClient.listTools()).tools ?? []) as ToolLike[];

    expect(coreTools.length).toBeGreaterThan(120);
    expect(bridgeTools.map((tool) => tool.name)).toEqual(coreTools.map((tool) => tool.name));

    const coreRequired = requiredPaths(coreTools);
    const bridgeRequired = requiredPaths(bridgeTools);
    // Guard against a vacuous comparison: nested `required` must actually exist.
    expect(Object.keys(coreRequired).length).toBeGreaterThan(50);
    expect(bridgeRequired).toEqual(coreRequired);

    // tasks_bulk_create is the reported regression: item requires only `title`.
    expect(coreRequired['tasks_bulk_create:items.[]']).toBe('title');
    expect(bridgeRequired['tasks_bulk_create:items.[]']).toBe('title');
    // project_transitions_set keeps its top-level `required` (nullable field).
    expect(coreRequired['project_transitions_set:<root>']).toBe('transitions');
    expect(bridgeRequired['project_transitions_set:<root>']).toBe('transitions');
  });

  it('publishes identical constraint keywords (description, enum, bounds, default, format, pattern)', async () => {
    const bridgeTools = ((await bridgeClient.listTools()).tools ?? []) as ToolLike[];
    const coreCounts = constraintCounts(coreTools);
    const bridgeCounts = constraintCounts(bridgeTools);

    expect(coreCounts.description).toBeGreaterThan(150);
    expect(coreCounts.enum).toBeGreaterThan(20);
    expect(coreCounts.minLength).toBeGreaterThan(50);
    expect(coreCounts.minimum).toBeGreaterThan(20);
    expect(bridgeCounts).toEqual(coreCounts);
  });

  it('publishes the whole tools/list result verbatim', async () => {
    const bridgeTools = (await bridgeClient.listTools()).tools ?? [];
    expect(bridgeTools).toEqual(coreTools);
  });

  it('mirrors prompts, resources and resource templates', async () => {
    const [corePrompts, bridgePrompts] = await Promise.all([httpClient.listPrompts(), bridgeClient.listPrompts()]);
    expect(bridgePrompts).toEqual(corePrompts);

    const [coreResources, bridgeResources] = await Promise.all([httpClient.listResources(), bridgeClient.listResources()]);
    expect((coreResources.resources ?? []).length).toBeGreaterThan(50);
    expect(bridgeResources).toEqual(coreResources);

    const [coreTemplates, bridgeTemplates] = await Promise.all([httpClient.listResourceTemplates(), bridgeClient.listResourceTemplates()]);
    expect((coreTemplates.resourceTemplates ?? []).length).toBeGreaterThan(0);
    expect(bridgeTemplates).toEqual(coreTemplates);
  });

  it('exposes tools, resources and prompts, mirroring the core listChanged flags', async () => {
    const coreCaps = httpClient.getServerCapabilities();
    const bridgeCaps = bridgeClient.getServerCapabilities();
    // The core's HTTP session server advertises no capabilities of its own, so
    // only the bridge-side surface is guaranteed; flags must still be truthful.
    expect(bridgeCaps?.tools).toBeDefined();
    expect(bridgeCaps?.resources).toBeDefined();
    expect(bridgeCaps?.prompts).toBeDefined();
    expect(Boolean(bridgeCaps?.tools?.listChanged)).toBe(Boolean(coreCaps?.tools?.listChanged));
    expect(Boolean(bridgeCaps?.resources?.listChanged)).toBe(Boolean(coreCaps?.resources?.listChanged));
    expect(Boolean(bridgeCaps?.prompts?.listChanged)).toBe(Boolean(coreCaps?.prompts?.listChanged));
  });

  it('runs tasks_bulk_create with a single title through the bridge', async () => {
    const result = await bridgeClient.callTool({
      name: 'tasks_bulk_create',
      arguments: { items: [{ title: 'MU-09 one-title task' }] },
    });
    expect(result.isError).toBeFalsy();
    const payload = textResult(result as { content?: Array<{ text?: string }>; isError?: boolean });
    expect(payload.ok).toBe(true);
    const data = payload.data as { count?: number; created?: Array<{ id?: string; title?: string }> };
    expect(data.count).toBe(1);
    expect(data.created?.[0]?.title).toBe('MU-09 one-title task');

    // The task really landed on the core, not in a bridge-local store.
    const id = String(data.created?.[0]?.id ?? '');
    const fetched = textResult((await httpClient.callTool({ name: 'tasks_get', arguments: { id } })) as { content?: Array<{ text?: string }> });
    expect(fetched.ok).toBe(true);
    expect((fetched.data as { id?: string }).id).toBe(id);
  });

  it('rejects an invalid enum with the core validation message instead of a bridge mirror error', async () => {
    const args = { items: [{ title: 'MU-09 bad enum', priority: 'nonsense' }] };
    const direct = (await httpClient.callTool({ name: 'tasks_bulk_create', arguments: args })) as { content?: Array<{ text?: string }>; isError?: boolean };
    const viaBridge = (await bridgeClient.callTool({ name: 'tasks_bulk_create', arguments: args })) as { content?: Array<{ text?: string }>; isError?: boolean };

    const directText = direct.content?.find((part) => typeof part.text === 'string')?.text ?? '';
    const bridgeText = viaBridge.content?.find((part) => typeof part.text === 'string')?.text ?? '';

    expect(direct.isError).toBe(true);
    expect(viaBridge.isError).toBe(true);
    expect(directText).toContain("Invalid enum value. Expected 'low' | 'medium' | 'high'");
    expect(bridgeText).toBe(directText);
    expect(bridgeText).not.toContain('Required at items[0]');
  });

  it('answers tool_schema identically through the bridge', async () => {
    const direct = await httpClient.callTool({ name: 'tool_schema', arguments: { name: 'tasks_bulk_create' } });
    const viaBridge = await bridgeClient.callTool({ name: 'tool_schema', arguments: { name: 'tasks_bulk_create' } });
    expect(textResult(viaBridge as { content?: Array<{ text?: string }> })).toEqual(
      textResult(direct as { content?: Array<{ text?: string }> }),
    );
  });
});
