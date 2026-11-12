import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(process.cwd(), '.tmp-tests-webhooks');
process.env.DATA_DIR = ROOT;
process.env.OBSIDIAN_VAULT_ROOT = path.join(ROOT, 'vault');

let dispatchWebhook: typeof import('../src/webhooks.js').dispatchWebhook;
let server: http.Server;
let port = 0;
const received: Array<{ body: string; sig: string }> = [];

beforeAll(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true }); await fsp.mkdir(ROOT, { recursive: true });
  server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { received.push({ body, sig: String(req.headers['x-mcp-signature']) }); res.writeHead(200).end('ok'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
  ({ dispatchWebhook } = await import('../src/webhooks.js'));
  await fsp.writeFile(path.join(ROOT, '.webhooks.json'), JSON.stringify([{ id: 'w1', url: `http://127.0.0.1:${port}/hook`, secret: 's3cret', events: ['task.updated'] }]));
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); await fsp.rm(ROOT, { recursive: true, force: true }); });

describe('T-04 outgoing webhooks', () => {
  it('delivers once with a valid HMAC signature', async () => {
    const r = await dispatchWebhook({ event: 'task.updated', data: { id: 't1' } }, { allowPrivate: true });
    expect(r.delivered).toBe(1);
    expect(received).toHaveLength(1);
    const expected = crypto.createHmac('sha256', 's3cret').update(received[0].body).digest('hex');
    expect(received[0].sig).toBe(`sha256=${expected}`);
    expect(JSON.parse(received[0].body).data.id).toBe('t1');
  });

  it('does not throw when the receiver is unavailable', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const r = await dispatchWebhook({ event: 'task.updated', data: {} }, { allowPrivate: true });
    expect(r.failed).toBe(1);
  });
});
