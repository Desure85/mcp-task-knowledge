import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function mcpOrigin(): string {
  const raw = process.env.MCP_API_URL?.trim() || 'http://127.0.0.1:3001';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://127.0.0.1:3001';
  }
}

function normalizedOrigin(url: URL): string {
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return `${url.protocol}//${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

/**
 * Redeem a one-time setup link server-side. Restricting the target to the
 * configured MCP origin keeps this from becoming an SSRF relay.
 */
export async function POST(request: Request) {
  let link = '';
  try {
    const body = (await request.json()) as { link?: unknown };
    link = typeof body.link === 'string' ? body.link.trim() : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос.' }, { status: 400 });
  }
  if (!link) return NextResponse.json({ ok: false, error: 'Ссылка не указана.' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(link);
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректная ссылка.' }, { status: 400 });
  }
  if (normalizedOrigin(target) !== normalizedOrigin(new URL(mcpOrigin())) || !target.pathname.startsWith('/.well-known/mcp-setup/')) {
    return NextResponse.json({ ok: false, error: 'Ссылка не принадлежит этому серверу.' }, { status: 400 });
  }

  try {
    const response = await fetch(target, {
      headers: { accept: 'text/markdown' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json({ ok: false, error: text || `HTTP ${response.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, markdown: text });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `Сервер недоступен: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
