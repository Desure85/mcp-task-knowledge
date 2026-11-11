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

/**
 * Check a scoped setup token with a real MCP `initialize` request. This is a
 * server-side probe so the browser does not need CORS on the MCP origin.
 */
export async function POST(request: Request) {
  let token = '';
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === 'string' ? body.token.trim() : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос.' }, { status: 400 });
  }
  if (!token) return NextResponse.json({ ok: false, error: 'Токен не указан.' }, { status: 400 });

  const endpoint = `${mcpOrigin()}/mcp`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'mcp-task-knowledge-web-check', version: '1.0.0' },
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      await fetch(endpoint, { method: 'DELETE', headers: { ...headers, 'mcp-session-id': sessionId } }).catch(() => undefined);
    }
    if (!response.ok) {
      return NextResponse.json({ ok: false, status: response.status, error: `HTTP ${response.status}` }, { status: 502 });
    }
    let server: string | undefined;
    let rpcError: string | undefined;
    try {
      const parsed = JSON.parse(text) as { result?: { serverInfo?: { name?: string } }; error?: { message?: string } };
      server = parsed.result?.serverInfo?.name;
      rpcError = parsed.error?.message;
    } catch {
      // SSE/progress framed response: a 200 initialize is enough for the check.
    }
    if (rpcError) {
      return NextResponse.json({ ok: false, status: response.status, error: rpcError }, { status: 502 });
    }
    return NextResponse.json({ ok: true, status: response.status, server });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `Сервер недоступен: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
