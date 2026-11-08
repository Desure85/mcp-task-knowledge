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
