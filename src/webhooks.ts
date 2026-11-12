/** T-04: outgoing webhooks with HMAC, one retry and basic SSRF guards. */
import { createHmac } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { pathExists } from './fs.js';

export interface WebhookSubscription { id: string; url: string; secret: string; events: string[] }
export interface WebhookEvent { event: string; project?: string; data: unknown }

const STORE = path.join(DATA_DIR, '.webhooks.json');

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function readWebhooks(): Promise<WebhookSubscription[]> {
  if (!(await pathExists(STORE))) return [];
  try { return JSON.parse(await fs.readFile(STORE, 'utf8')) as WebhookSubscription[]; } catch { return []; }
}

export async function dispatchWebhook(
  event: WebhookEvent,
  opts: { allowPrivate?: boolean } = {},
): Promise<{ delivered: number; failed: number }> {
  const subs = (await readWebhooks()).filter((s) => s.events.includes(event.event) || s.events.includes('*'));
  let delivered = 0;
  let failed = 0;
  for (const sub of subs) {
    let url: URL;
    try { url = new URL(sub.url); } catch { failed++; continue; }
    if (!opts.allowPrivate && (url.protocol !== 'https:' || isPrivateHost(url.hostname))) { failed++; continue; }
    const body = JSON.stringify({ ...event, deliveryId: `${sub.id}:${Date.now()}`, at: new Date().toISOString() });
    const signature = createHmac('sha256', sub.secret).update(body).digest('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-mcp-signature': `sha256=${signature}` },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) { delivered++; break; }
        if (attempt === 1) failed++;
      } catch { if (attempt === 1) failed++; }
    }
  }
  return { delivered, failed };
}
