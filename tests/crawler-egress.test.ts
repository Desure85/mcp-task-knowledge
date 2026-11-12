import { describe, expect, it } from 'vitest';
import { assertEgressAllowed, EgressError, safeFetchText } from '../src/connectors/egress.js';

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try { await fn(); throw new Error('expected rejection'); }
  catch (e) { expect(e).toBeInstanceOf(EgressError); expect((e as EgressError).code).toBe(code); }
}

describe('TR-30 web crawler egress policy', () => {
  it('rejects non-http schemes, credentials and private hosts', async () => {
    await expectCode(() => assertEgressAllowed('file:///etc/passwd'), 'EGRESS_SCHEME');
    await expectCode(() => assertEgressAllowed('ftp://example.com/a'), 'EGRESS_SCHEME');
    await expectCode(() => assertEgressAllowed('https://user:pass@example.com/'), 'EGRESS_CREDENTIALS');
    await expectCode(() => assertEgressAllowed('http://localhost:3000/'), 'EGRESS_PRIVATE');
    await expectCode(() => assertEgressAllowed('http://127.0.0.1/'), 'EGRESS_PRIVATE');
    await expectCode(() => assertEgressAllowed('http://10.0.0.5/'), 'EGRESS_PRIVATE');
    await expectCode(() => assertEgressAllowed('http://169.254.169.254/latest/meta-data'), 'EGRESS_PRIVATE');
    await expectCode(() => assertEgressAllowed('http://[::1]/'), 'EGRESS_PRIVATE');
  });

  it('allows public literals and enforces host allowlist', async () => {
    await expect(assertEgressAllowed('https://93.184.216.34/')).resolves.toBeInstanceOf(URL);
    await expect(assertEgressAllowed('https://example.com/', { allowedHosts: ['example.com'] })).resolves.toBeInstanceOf(URL);
    await expectCode(() => assertEgressAllowed('https://other.example/', { allowedHosts: ['example.com'] }), 'EGRESS_HOST');
  });

  it('checks redirect targets and limits redirect hops', async () => {
    const toPrivate = (async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } })) as unknown as typeof fetch;
    await expectCode(() => safeFetchText('https://93.184.216.34/', { fetchImpl: toPrivate }), 'EGRESS_PRIVATE');
    const loop = (async () => new Response(null, { status: 302, headers: { location: 'https://93.184.216.34/next' } })) as unknown as typeof fetch;
    await expectCode(() => safeFetchText('https://93.184.216.34/', { fetchImpl: loop, maxRedirects: 2 }), 'EGRESS_REDIRECT');
    const ok = (async () => new Response('<html><title>T</title><p>Body</p></html>', { status: 200 })) as unknown as typeof fetch;
    const res = await safeFetchText('https://93.184.216.34/', { fetchImpl: ok });
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>T</title>');
  });
});
