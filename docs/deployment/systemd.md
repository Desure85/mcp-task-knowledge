# systemd (single core on a Linux host)

Use this when the core runs directly on a Linux machine instead of a container: one server process
owns `DATA_DIR`, every client reaches it over HTTP, and stdio-only clients go through the bridge.

The layout below uses placeholders on purpose — replace `<install-dir>`, `<data-dir>`, `<port>`,
`<unit>` and `<token>` with your values. Nothing here belongs in the repository: paths, ports,
logins and secrets stay on the host.

## 1. Install the tree

The service needs `dist/`, `package.json` and production `node_modules`. Build elsewhere (CI or a
build host) and copy the result, or build in place if the host has Node 24:

```bash
sudo useradd --system --home /opt/<install-dir> --shell /usr/sbin/nologin <service-user>
sudo mkdir -p /opt/<install-dir> /var/lib/<data-dir>
sudo chown -R <service-user>:<service-group> /opt/<install-dir> /var/lib/<data-dir>
```

`DATA_DIR` is a plain directory of files, so it is the only thing worth backing up.

## 2. Environment file

Keep every setting in one root-owned file and out of the unit: the unit is world-readable, the
environment file is not.

```bash
sudo install -m 640 -o root -g <service-group> /dev/null /etc/<app>/core.env
```

```bash
DATA_DIR=/var/lib/<data-dir>
MCP_TRANSPORT=http
MCP_HOST=127.0.0.1
MCP_PORT=<port>
EMBEDDINGS_MODE=none
LOG_LEVEL=info
LOG_FORMAT=json

# Only when this core accepts logins. Leave the file at 640 and never commit it.
# MCP_LOGIN_USER=<login>
# MCP_LOGIN_PASSWORD=<password>
# JWT_SECRET=<long-random-value>
```

- `MCP_PORT` (default `3001`) is the only port variable — `PORT` is ignored.
- `MCP_HOST=127.0.0.1` keeps the core on loopback; use `0.0.0.0` only behind a firewall or a
  reverse proxy that terminates TLS.
- `EMBEDDINGS_MODE=none` runs BM25-only; `onnx-cpu` needs a model file (see
  [Configuration](../getting-started/configuration.md)).

## 3. Unit

```ini
[Unit]
Description=MCP task & knowledge core (http transport)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<service-user>
Group=<service-group>
WorkingDirectory=/opt/<install-dir>
EnvironmentFile=/etc/<app>/core.env
ExecStart=/usr/bin/node /opt/<install-dir>/dist/index.js
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/<data-dir>

[Install]
WantedBy=multi-user.target
```

- `KillSignal=SIGTERM` with a real `TimeoutStopSec`: shutdown is graceful and must be allowed to
  finish, otherwise an in-flight write is what you lose.
- `ProtectSystem=strict` makes everything read-only except `ReadWritePaths`; add the model directory
  there as well if embeddings are on.
- There is **one process per `DATA_DIR`**. A second unit (or a manual `node dist/index.js`) pointing
  at the same directory exits with `SERVER_LOCK_HELD`; that is the guard working, not a bug.

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now <unit>
```

## 4. Verify

```bash
curl -fsS http://127.0.0.1:<port>/healthz && echo OK
curl -fsS http://127.0.0.1:<port>/readyz   && echo READY
ss -ltnp 'sport = :<port>'
journalctl -u <unit> -n 50 --no-pager
```

`/healthz` reports process liveness, `/readyz` readiness once storage is open, `/drainz` reports
shutdown draining and `/metrics` exposes Prometheus counters. Over HTTP the MCP endpoint is `/mcp`.

## 5. Updating

```bash
sudo rsync -a --delete <new-tree>/dist/ /opt/<install-dir>/dist/
sudo npm --prefix /opt/<install-dir> ci --omit=dev   # only when dependencies changed
sudo systemctl restart <unit>
curl -fsS http://127.0.0.1:<port>/readyz
```

Keep the previous `dist/` as `dist.previous` until `/readyz` is green; rollback is swapping the
directories back and restarting. Restarting is safe for data: writes are atomic and the lock is
released on exit.

## 6. Clients

HTTP-capable clients connect straight to `http://<host>:<port>/mcp` and authenticate with
`mcp.authenticate` (token) or the login flow that issues the JWT.

stdio-only clients (IDE extensions, agents) must not start their own server over the same
`DATA_DIR`; point them at the running core through the bridge, which forwards MCP over HTTP and never
touches the data directory or the lock:

```json
{
  "mcpServers": {
    "task-knowledge": {
      "command": "mcp-task-knowledge",
      "args": ["bridge", "--url", "http://127.0.0.1:<port>/mcp"],
      "env": { "MCP_PROXY_TOKEN": "<token>" }
    }
  }
}
```

The token can also be passed as `--token`, but the environment is preferred: command lines are
visible in `ps`. `MCP_PROXY_UPSTREAM` is the environment equivalent of `--url`. The bridge exits with
`2` on usage errors, `3` when the core is unreachable and `4` when authentication fails.
`tools/list`, `prompts/list`, `resources/list` and `resources/templates/list` are forwarded verbatim:
the bridge does not rewrite JSON Schema, so nested required fields, enums, bounds, defaults and
descriptions match a direct HTTP connection, and argument validation stays on the core.

More on the bridge contract:
[Configuration → Agents over stdio to one http core](../getting-started/configuration.md#agents-over-stdio-to-one-http-core).

## 7. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| Service exits with `SERVER_LOCK_HELD` | Another process owns this `DATA_DIR` | Stop the other unit or point it at its own directory |
| `SERVER_LOCK_FOREIGN_HOST` | The lock was written by another host over a shared filesystem | Confirm that host is down, then remove `DATA_DIR/.server.lock` |
| `EADDRINUSE` on start | Something else holds the port | `ss -ltnp 'sport = :<port>'`; pick another `MCP_PORT` in the environment file |
| Clients see `401` | No token, expired token, or a revoked one after logout | Re-authenticate; issue a setup link with `admin_setup_link` |
| Bridge exits `3` | Core not listening on that URL | Check `/healthz` and `MCP_HOST`/`MCP_PORT` |

Docker, Compose and Kubernetes variants: [Docker & Deployment](docker.md).
