# Realtime (WebSocket) configuration

The web UI works without realtime: every page keeps loading and mutating data through the MCP HTTP transport. The Topbar indicator only reports whether live events are available.

## Configure the endpoint

The browser opens the MCP server's WebSocket directly. Next.js rewrites HTTP requests but does not proxy WebSocket upgrades, so set the endpoint explicitly when the UI and MCP server have different origins:

```bash
# build-time for the Next.js UI
NEXT_PUBLIC_MCP_WS_URL=ws://localhost:3001/ws
MCP_API_URL=http://localhost:3001
NEXT_PUBLIC_MCP_API_URL=/api/mcp
```

`MCP_API_URL` is used by the Next.js rewrite at build time. `NEXT_PUBLIC_MCP_WS_URL` is embedded in the browser bundle, so rebuild the UI after changing it.

If the UI is served from the MCP origin, the client can fall back to same-origin `/ws`. If that endpoint is unavailable and no explicit URL is set, the indicator reports **Realtime off** and the page continues without live updates.

## Indicator states

| State | Meaning | What to do |
|-------|---------|------------|
| **Live** | Authenticated WebSocket is open | Nothing |
| **Connecting** | A connection attempt is in progress (attempt number shown) | Wait up to 5 seconds |
| **Reconnecting** | A previously live connection was lost; a retry is scheduled | Wait, or open the popover to inspect the reason |
| **Offline** | The server could not be reached or the connect attempt timed out | Check the address/network; use **Retry now** |
| **Realtime off** | No WebSocket URL is configured and same-origin `/ws` is unavailable | Set `NEXT_PUBLIC_MCP_WS_URL` and rebuild the UI |

A 401 when requesting the one-time WS ticket sends the user to the existing login flow. A network or 5xx failure while requesting the ticket is treated as a transient reconnect. Realtime never blocks page data.

## Auth

Realtime uses the same session JWT as the rest of the UI: the browser exchanges it for a single-use ticket via `POST /auth/ws-ticket`, then upgrades with `?ticket=`. The JWT is never put in the WebSocket URL. After `open` the client sends `{type:"subscribe", project}` **only when the page has a project**; pages without a project receive global/presence events without a subscription. A fresh ticket is requested before every reconnect.
