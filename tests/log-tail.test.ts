/**
 * AC-04c — `logs_tail`: read-only log tail with secret masking and rotation.
 *
 * The sink is opt-in (`LOG_FILE`), so the tests drive the file directly: the reader, the masking
 * and the rotation are pure functions of a file on disk, and the tool only adds resolution and the
 * envelope.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServerContext } from '../src/register/setup.js';
import { defaultRegistration } from '../src/core/app-container.js';
import { readLogTail, scrubSecrets, resolveLogFile } from '../src/core/log-file.js';
import { createRotatingStream } from '../src/core/log-rotation.js';
import type { ServerContext } from '../src/register/context.js';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

let tmpDir: string;
let ctx: ServerContext;
let client: Client;
const originalLogFile = process.env.LOG_FILE;

function record(level: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...extra });
}

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(((res?.content as any)?.[0]?.text as string) ?? '{}');
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac04c-'));
  ctx = await createServerContext();
  await defaultRegistration(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await ctx.server.connect(serverTransport);
  client = new Client({ name: 'ac04c', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.LOG_FILE;
});

afterEach(() => {
  if (originalLogFile === undefined) delete process.env.LOG_FILE;
  else process.env.LOG_FILE = originalLogFile;
});

describe('AC-04c: secret masking', () => {
  it('masks JWTs, bearer tokens, provider keys and password fields', () => {
    const masked = scrubSecrets(
      `{"msg":"auth","token":"${JWT}","header":"Bearer abcdefghijklmnop","key":"sk-abcdefghijklmnopqrstuvwx","gh":"ghp_abcdefghijklmnop","password":"hunter2"}`,
    );
    expect(masked.masked).toBe(true);
    expect(masked.line).not.toContain('hunter2');
    expect(masked.line).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(masked.line).not.toContain(JWT);
    expect(masked.line).toContain('[REDACTED_JWT]');
    // The generic field mask must not swallow the specific marker.
    expect(masked.line).toContain('Bearer [REDACTED_TOKEN]');
  });

  it('leaves ordinary lines untouched', () => {
    const line = 'plain text line without secrets';
    expect(scrubSecrets(line)).toEqual({ line, masked: false });
  });
});

describe('AC-04c: tail reader', () => {
  it('returns the newest lines and does not modify the file', () => {
    const file = path.join(tmpDir, 'app.log');
    const lines = Array.from({ length: 10 }, (_, index) => record('info', `line ${index}`));
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    const before = fs.readFileSync(file);
    const mtimeBefore = fs.statSync(file).mtimeMs;

    const tail = readLogTail({ file, lines: 3 });
    expect(tail.lines).toHaveLength(3);
    expect(tail.lines[2]).toContain('line 9');
    expect(tail.truncated).toBe(true);
    expect(tail.scanned).toBe(10);

    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore);
  });

  it('filters by level and keeps non-JSON lines', () => {
    const file = path.join(tmpDir, 'levels.log');
    const lines = [
      record('info', 'info line'),
      record('warn', 'warn line'),
      record('error', 'error line'),
      'stack trace line without json',
    ];
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

    const errors = readLogTail({ file, lines: 10, level: 'error' });
    expect(errors.lines).toHaveLength(2);
    expect(errors.lines[0]).toContain('error line');
    expect(errors.lines[1]).toBe('stack trace line without json');
  });

  it('caps the payload by bytes', () => {
    const file = path.join(tmpDir, 'big.log');
    const lines = Array.from({ length: 50 }, (_, index) => record('info', `payload ${index} ${'x'.repeat(200)}`));
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');

    const tail = readLogTail({ file, lines: 50, maxBytes: 2048 });
    const total = tail.lines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8') + 1, 0);
    expect(total).toBeLessThanOrEqual(2048);
    expect(tail.truncated).toBe(true);
  });
});

describe('AC-04c: rotation', () => {
  it('rotates the file and keeps the configured number of copies', async () => {
    const file = path.join(tmpDir, 'rotating.log');
    const stream = createRotatingStream(file, 512, 2);
    for (let index = 0; index < 20; index++) {
      stream.write(`${record('info', `rotation ${index} ${'y'.repeat(80)}`)}\n`);
    }
    stream.end();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.existsSync(`${file}.3`)).toBe(false);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(1024);
  });
});

describe('AC-04c: logs_tail tool', () => {
  it('explains that file logging is disabled', async () => {
    const res = await call('logs_tail', {});
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('LOG_FILE_DISABLED');
    expect(res.error.hint).toContain('LOG_FILE=');
  });

  it('returns masked lines from the configured file', async () => {
    const file = path.join(tmpDir, 'tool.log');
    fs.writeFileSync(
      file,
      [
        record('info', 'started'),
        record('error', 'token rejected', { token: JWT, header: `Bearer ${'z'.repeat(24)}` }),
      ].join('\n') + '\n',
      'utf8',
    );
    process.env.LOG_FILE = file;

    expect(resolveLogFile(process.env.DATA_DIR)).toBe(file);
    const res = await call('logs_tail', { lines: 10 });
    expect(res.ok).toBe(true);
    expect(res.data.count).toBe(2);
    expect(res.data.maskedLines).toBe(1);
    expect(res.data.lines.join('\n')).not.toContain(JWT);
    expect(res.data.lines.join('\n')).toContain('[REDACTED_JWT]');

    const errorsOnly = await call('logs_tail', { lines: 10, level: 'error' });
    expect(errorsOnly.data.count).toBe(1);
    expect(errorsOnly.data.lines[0]).toContain('token rejected');
  });
});

describe('AC-04d: secret classes (input -> output)', () => {
  const masked: Array<{ name: string; input: string; output: string }> = [
    {
      name: 'Basic authorization in a JSON field',
      input: '{"authorization":"Basic dXNlcjpwYXNz"}',
      output: '{"authorization":"Basic [REDACTED_TOKEN]"}',
    },
    {
      name: 'Basic authorization header',
      input: 'Authorization: Basic dXNlcjpwYXNz',
      output: 'Authorization: Basic [REDACTED_TOKEN]',
    },
    {
      name: 'token in a URL query',
      input: 'GET https://api.example.com/v1?token=abc123&limit=10',
      output: 'GET https://api.example.com/v1?token=[REDACTED]&limit=10',
    },
    {
      name: 'password in a query keeps the neighbour',
      input: '?password=hunter2&user=bob',
      output: '?password=[REDACTED]&user=bob',
    },
    {
      name: 'credentials in a connection string',
      input: 'postgres://app:s3cr3t@db.internal:5432/app',
      output: 'postgres://app:[REDACTED]@db.internal:5432/app',
    },
    {
      name: 'env-style assignments',
      input: 'MCP_LOGIN_PASSWORD=hunter2 MCP_PROXY_TOKEN=abc123',
      output: 'MCP_LOGIN_PASSWORD=[REDACTED] MCP_PROXY_TOKEN=[REDACTED]',
    },
    {
      name: 'AWS access key id',
      input: 'aws=AKIAIOSFODNN7EXAMPLE',
      output: 'aws=[REDACTED_AWS_KEY]',
    },
    {
      name: 'PEM private key block',
      input: '-----BEGIN RSA PRIVATE KEY-----MIIEow-----END RSA PRIVATE KEY-----',
      output: '[REDACTED_PRIVATE_KEY]',
    },
    {
      name: 'camelCase JSON keys',
      input: '{"clientSecret":"abc123","authToken":"xyz789"}',
      output: '{"clientSecret":"[REDACTED]","authToken":"[REDACTED]"}',
    },
    {
      name: 'dashed JSON key',
      input: '{"x-api-key":"abc123"}',
      output: '{"x-api-key":"[REDACTED]"}',
    },
    {
      name: 'dashed header key',
      input: 'x-api-key: abc123',
      output: 'x-api-key: [REDACTED]',
    },
    {
      name: 'query-style password with user',
      input: 'password=hunter2&user=bob',
      output: 'password=[REDACTED]&user=bob',
    },
  ];

  const untouched: Array<{ name: string; input: string }> = [
    { name: 'long commit hash', input: 'sha=3f786850e387550fdab836ed7e6dc881de23001b' },
    { name: 'uuid', input: 'id=123e4567-e89b-12d3-a456-426614174000' },
    { name: 'numeric counter next to a token word', input: '{"tokenCount": 5}' },
    { name: 'prose about Basic auth', input: 'Basic authentication failed' },
    { name: 'plain URL with paging', input: 'https://example.com/path?limit=10&page=2' },
    { name: 'certificate block', input: '-----BEGIN CERTIFICATE-----MIIB-----END CERTIFICATE-----' },
    { name: 'user without a password', input: 'https://user@example.com/path' },
  ];

  it.each(masked)('masks $name', ({ input, output }) => {
    const result = scrubSecrets(input);
    expect(result.line).toBe(output);
    expect(result.masked).toBe(true);
  });

  it.each(untouched)('leaves $name untouched', ({ input }) => {
    const result = scrubSecrets(input);
    expect(result.line).toBe(input);
    expect(result.masked).toBe(false);
  });
});

describe('AC-04e: log diagnostics candidates', () => {
  it('reads active + rotated segments, oldest first', () => {
    const file = path.join(tmpDir, 'rotated-read.log');
    fs.writeFileSync(`${file}.2`, `${record('info', 'oldest')}\n`);
    fs.writeFileSync(`${file}.1`, `${record('info', 'middle')}\n`);
    fs.writeFileSync(file, `${record('info', 'newest')}\n`);
    const tail = readLogTail({ file, lines: 10 });
    expect(tail.segments.map((s) => path.basename(s))).toEqual(['rotated-read.log.2', 'rotated-read.log.1', 'rotated-read.log']);
    expect(tail.lines).toHaveLength(3);
    expect(tail.lines[0]).toContain('oldest');
    expect(tail.lines[2]).toContain('newest');
  });

  it('filters by requestId and project', () => {
    const file = path.join(tmpDir, 'filtered.log');
    fs.writeFileSync(file, [
      record('info', 'other', { requestId: 'r-1', project: 'alpha' }),
      record('error', 'target', { requestId: 'r-2', project: 'beta' }),
      'plain line without json',
    ].join('\n') + '\n');
    expect(readLogTail({ file, requestId: 'r-2' }).lines).toHaveLength(1);
    expect(readLogTail({ file, requestId: 'r-2' }).lines[0]).toContain('target');
    expect(readLogTail({ file, project: 'alpha' }).lines).toHaveLength(1);
    expect(readLogTail({ file, project: 'alpha' }).lines[0]).toContain('other');
    expect(readLogTail({ file, requestId: 'r-2', project: 'alpha' }).lines).toHaveLength(0);
  });

  it('passes requestId/project through logs_tail', async () => {
    const file = path.join(tmpDir, 'tool-filter.log');
    fs.writeFileSync(file, [
      record('info', 'alpha line', { requestId: 'r-a', project: 'alpha' }),
      record('info', 'beta line', { requestId: 'r-b', project: 'beta' }),
    ].join('\n') + '\n');
    process.env.LOG_FILE = file;
    const byId = await call('logs_tail', { requestId: 'r-b' });
    expect(byId.ok).toBe(true);
    expect(byId.data.count).toBe(1);
    expect(byId.data.lines[0]).toContain('beta line');
    const byProject = await call('logs_tail', { project: 'alpha' });
    expect(byProject.data.count).toBe(1);
    expect(byProject.data.lines[0]).toContain('alpha line');
  });
});
