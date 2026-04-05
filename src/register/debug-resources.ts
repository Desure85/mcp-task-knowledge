import type { ServerContext } from './context.js';

export function registerDebugResources(ctx: ServerContext): void {
  try {
    ctx.server.registerResource(
      'resource_catalog',
      'resource://catalog',
      { title: 'Resources Catalog', description: 'List of registered resources (supports ?q=&scheme=&kind=&sort=&order=&offset=&limit=)', mimeType: 'application/json' },
      async (u) => {
        const url = new URL(u.href);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const schemeFilter = (url.searchParams.get('scheme') || '').trim();
        const kindFilter = (url.searchParams.get('kind') || '').trim();
        const sort = (url.searchParams.get('sort') || 'uri').toLowerCase();
        const order = (url.searchParams.get('order') || 'asc').toLowerCase();
        const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
        const limitRaw = Number(url.searchParams.get('limit') || 1000);
        const limit = Math.max(1, Math.min(5000, isNaN(limitRaw) ? 1000 : limitRaw));

        const getScheme = (uri: string): string => {
          const m = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
          return m ? m[1] : 'unknown';
        };

        const total = ctx.resourceRegistry.length;
        let items = ctx.resourceRegistry.map(r => ({ ...r, scheme: getScheme(r.uri) }));

        if (kindFilter === 'static' || kindFilter === 'template') {
          items = items.filter(i => i.kind === kindFilter);
        }
        if (schemeFilter) {
          const s = schemeFilter.toLowerCase();
          items = items.filter(i => i.scheme.toLowerCase() === s);
        }
        if (q) {
          items = items.filter(i => (
            i.id.toLowerCase().includes(q) ||
            i.uri.toLowerCase().includes(q) ||
            (i.title || '').toLowerCase().includes(q) ||
            (i.description || '').toLowerCase().includes(q)
          ));
        }

        const cmp = (a: any, b: any): number => {
          const dir = order === 'desc' ? -1 : 1;
          const pick = (k: string) => {
            if (k === 'scheme') return String(a.scheme || '').localeCompare(String(b.scheme || '')) * dir;
            if (k === 'id') return String(a.id || '').localeCompare(String(b.id || '')) * dir;
            if (k === 'title') return String(a.title || '').localeCompare(String(b.title || '')) * dir;
            return String(a.uri || '').localeCompare(String(b.uri || '')) * dir;
          };
          return pick(sort);
        };
        items.sort(cmp);

        const filtered = items.length;
        const sliced = items.slice(offset, offset + limit);
        const payload = { total, filtered, offset, limit, sort, order, items: sliced };
        return { contents: [{ uri: u.href, text: JSON.stringify(payload, null, 2), mimeType: 'application/json' }] };
      }
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: resource://catalog — skipping'); else throw e; }

  try {
    ctx.server.registerResource(
      'mcp_capabilities',
      'mcp://capabilities',
      { title: 'MCP Capabilities', description: 'Declared server capabilities for client debugging', mimeType: 'application/json' },
      async (u) => ({ contents: [{ uri: u.href, text: JSON.stringify(ctx.SERVER_CAPS, null, 2), mimeType: 'application/json' }] })
    );
  } catch (e: any) { const m = e?.message || String(e); if (typeof m === 'string' && m.includes('already registered')) console.warn('[resources] already registered: mcp://capabilities — skipping'); else throw e; }
}
