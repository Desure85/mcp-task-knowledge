import fs from "node:fs";
import path from "node:path";
function pickRemote(cfg) {
    if (cfg.mode === "remote")
        return true;
    if (cfg.mode === "embedded")
        return false;
    // hybrid
    return cfg.prefer === "remote";
}
function ensureArray(v) {
    if (v == null)
        return undefined;
    return Array.isArray(v) ? v : [v];
}
async function remoteQuery(baseUrl, q, timeoutMs) {
    const u = new URL("/api/services", baseUrl);
    const p = u.searchParams;
    if (q.search)
        p.set("search", q.search);
    if (q.component)
        p.set("component", q.component);
    for (const o of ensureArray(q.owner) || [])
        p.append("owner", o);
    for (const t of ensureArray(q.tag) || [])
        p.append("tag", t);
    if (q.domain)
        p.set("domain", q.domain);
    if (q.status)
        p.set("status", q.status);
    if (q.updatedFrom)
        p.set("updatedFrom", q.updatedFrom);
    if (q.updatedTo)
        p.set("updatedTo", q.updatedTo);
    if (q.sort)
        p.set("sort", q.sort);
    if (q.page != null)
        p.set("page", String(q.page));
    if (q.pageSize != null)
        p.set("pageSize", String(q.pageSize));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs));
    try {
        const res = await fetch(u.toString(), { signal: ctrl.signal, headers: { Accept: "application/json" } });
        if (!res.ok)
            throw new Error(`remote query failed ${res.status}`);
        const data = await res.json();
        return data;
    }
    finally {
        clearTimeout(timer);
    }
}
async function remoteHealth(baseUrl, timeoutMs) {
    const u = new URL("/api/health", baseUrl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, timeoutMs));
    try {
        const res = await fetch(u.toString(), { signal: ctrl.signal, headers: { Accept: "application/json" } });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
export function createServiceCatalogProvider(cfg) {
    const useRemotePreferred = pickRemote(cfg);
    const embedded = {
        initialized: false,
        items: [],
        filePath: cfg.embedded?.filePath,
        lastLoadedAt: undefined,
        lastCheckedAt: undefined,
    };
    // Optional external library handle (service-catalog/lib)
    let embeddedLibHandle = null;
    let embeddedTriedImport = false;
    async function getEmbeddedLibHandle() {
        if (embeddedLibHandle || embeddedTriedImport)
            return embeddedLibHandle;
        embeddedTriedImport = true;
        try {
            // Dynamic import to avoid hard dependency
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const lib = await import("service-catalog/lib");
            if (lib?.initEmbeddedCatalog) {
                const initArgs = {
                    // allow 'memory' | 'file' | 'sqlite' (sqlite depends on external driver availability)
                    store: cfg.embedded.store,
                    filePath: cfg.embedded.filePath,
                    prefix: cfg.embedded.prefix,
                };
                // Optional: sqlite driver hint ('auto' | 'native' | 'wasm')
                if (cfg.embedded.store === "sqlite" && cfg.embedded.sqliteDriver) {
                    initArgs.driver = cfg.embedded.sqliteDriver;
                }
                embeddedLibHandle = await lib.initEmbeddedCatalog(initArgs);
                return embeddedLibHandle;
            }
        }
        catch {
            // Library not installed or failed — fallback to local implementation
            embeddedLibHandle = null;
        }
        return embeddedLibHandle;
    }
    function reloadIfNeeded() {
        if (cfg.embedded.store !== "file") {
            // memory mode: nothing to reload
            embedded.initialized = true;
            return;
        }
        const p = embedded.filePath || undefined;
        if (!p) {
            // no path provided — treat as empty catalog but initialized
            embedded.initialized = true;
            embedded.items = [];
            return;
        }
        try {
            if (!fs.existsSync(p)) {
                embedded.initialized = true;
                embedded.items = [];
                embedded.lastLoadedAt = undefined;
                return;
            }
            const st = fs.statSync(p);
            const m = st.mtimeMs;
            if (!embedded.initialized || embedded.lastLoadedAt !== m) {
                const raw = fs.readFileSync(p, "utf8");
                // Accept either { items: ServiceItem[] } or raw array
                const data = JSON.parse(raw);
                const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
                embedded.items = items;
                embedded.lastLoadedAt = m;
                embedded.initialized = true;
            }
        }
        catch (e) {
            // On parse/read error, keep previous items but mark initialized
            embedded.initialized = true;
        }
    }
    function applyFilters(items, q) {
        const owners = ensureArray(q.owner);
        const tags = ensureArray(q.tag);
        const search = (q.search || "").toLowerCase().trim();
        const updatedFrom = q.updatedFrom ? Date.parse(q.updatedFrom) : undefined;
        const updatedTo = q.updatedTo ? Date.parse(q.updatedTo) : undefined;
        let out = items.filter((it) => {
            if (q.component && it.component !== q.component)
                return false;
            if (q.domain && it.domain !== q.domain)
                return false;
            if (q.status && it.status !== q.status)
                return false;
            if (owners && owners.length > 0) {
                const have = new Set(it.owners || []);
                if (!owners.some((o) => have.has(o)))
                    return false;
            }
            if (tags && tags.length > 0) {
                const have = new Set(it.tags || []);
                if (!tags.some((t) => have.has(t)))
                    return false;
            }
            if (updatedFrom != null || updatedTo != null) {
                const t = it.updatedAt ? Date.parse(it.updatedAt) : NaN;
                if (!Number.isFinite(t))
                    return false;
                if (updatedFrom != null && t < updatedFrom)
                    return false;
                if (updatedTo != null && t > updatedTo)
                    return false;
            }
            if (search) {
                const hay = `${it.id}\n${it.name}\n${it.component}\n${(it.tags || []).join(" ")}`.toLowerCase();
                if (!hay.includes(search))
                    return false;
            }
            return true;
        });
        // sort: "field:dir"
        if (q.sort) {
            const [field, dirRaw] = q.sort.split(":");
            const dir = (dirRaw || "asc").toLowerCase() === "desc" ? -1 : 1;
            out = out.slice().sort((a, b) => {
                const av = a[field];
                const bv = b[field];
                if (av == null && bv == null)
                    return 0;
                if (av == null)
                    return -1 * dir;
                if (bv == null)
                    return 1 * dir;
                if (field === "updatedAt") {
                    const at = Date.parse(String(av));
                    const bt = Date.parse(String(bv));
                    return (at - bt) * dir;
                }
                if (typeof av === "string" && typeof bv === "string")
                    return av.localeCompare(bv) * dir;
                if (typeof av === "number" && typeof bv === "number")
                    return (av - bv) * dir;
                return String(av).localeCompare(String(bv)) * dir;
            });
        }
        return out;
    }
    function paginate(items, page, pageSize) {
        const ps = pageSize && pageSize > 0 ? pageSize : 50;
        const pg = page && page > 0 ? page : 1;
        const start = (pg - 1) * ps;
        const chunk = items.slice(start, start + ps);
        return { items: chunk, total: items.length, page: pg, pageSize: ps };
    }
    return {
        mode: cfg.mode,
        async queryServices(q) {
            // Embedded implementation: file/memory backend
            const tryRemote = async () => {
                if (!cfg.remote.enabled || !cfg.remote.baseUrl)
                    throw new Error("remote disabled");
                return remoteQuery(cfg.remote.baseUrl, q, cfg.remote.timeoutMs);
            };
            const tryEmbedded = async () => {
                if (!cfg.embedded.enabled)
                    throw new Error("embedded disabled");
                const handle = await getEmbeddedLibHandle();
                if (handle?.queryServices) {
                    return handle.queryServices(q);
                }
                // fallback to built-in file/memory
                reloadIfNeeded();
                const filtered = applyFilters(embedded.items, q);
                return paginate(filtered, q.page, q.pageSize);
            };
            if (cfg.mode === "remote")
                return tryRemote();
            if (cfg.mode === "embedded")
                return tryEmbedded();
            // hybrid
            if (useRemotePreferred) {
                try {
                    return await tryRemote();
                }
                catch (e) {
                    return await tryEmbedded();
                }
            }
            else {
                try {
                    return await tryEmbedded();
                }
                catch (e) {
                    return await tryRemote();
                }
            }
        },
        async health() {
            if (cfg.mode === "remote") {
                const ok = cfg.remote.baseUrl ? await remoteHealth(cfg.remote.baseUrl, cfg.remote.timeoutMs) : false;
                return { ok, source: "remote" };
            }
            if (cfg.mode === "embedded") {
                const handle = await getEmbeddedLibHandle();
                if (handle?.health) {
                    const r = await handle.health();
                    return { ok: !!r?.ok, source: "embedded", detail: r?.detail ?? { via: "lib" } };
                }
                // fallback to built-in
                reloadIfNeeded();
                const detail = { store: cfg.embedded.store, filePath: embedded.filePath };
                if (cfg.embedded.store === "file") {
                    const p = embedded.filePath;
                    const ok = !!(p && fs.existsSync(p));
                    embedded.lastCheckedAt = new Date().toISOString();
                    return { ok, source: "embedded", detail };
                }
                embedded.lastCheckedAt = new Date().toISOString();
                return { ok: true, source: "embedded", detail };
            }
            // hybrid: probe preferred first, then fallback
            if (useRemotePreferred) {
                const ok = cfg.remote.baseUrl ? await remoteHealth(cfg.remote.baseUrl, cfg.remote.timeoutMs) : false;
                if (ok)
                    return { ok, source: "remote" };
                // fallback to embedded check
                const handle = await getEmbeddedLibHandle();
                if (handle?.health) {
                    const r = await handle.health();
                    return { ok: !!r?.ok, source: "embedded", detail: r?.detail ?? { via: "lib" } };
                }
                reloadIfNeeded();
                const detail = { store: cfg.embedded.store, filePath: embedded.filePath };
                if (cfg.embedded.store === "file") {
                    const p = embedded.filePath;
                    const ok2 = !!(p && fs.existsSync(p));
                    return { ok: ok2, source: "embedded", detail };
                }
                return { ok: true, source: "embedded", detail };
            }
            else {
                // prefer embedded first
                const handle = await getEmbeddedLibHandle();
                if (handle?.health) {
                    const r = await handle.health();
                    if (r?.ok)
                        return { ok: true, source: "embedded", detail: r?.detail ?? { via: "lib" } };
                }
                reloadIfNeeded();
                const detail = { store: cfg.embedded.store, filePath: embedded.filePath };
                if (cfg.embedded.store === "file") {
                    const p = embedded.filePath;
                    const okEmb = !!(p && fs.existsSync(p));
                    if (okEmb)
                        return { ok: true, source: "embedded", detail };
                }
                else {
                    return { ok: true, source: "embedded", detail };
                }
                // fallback to remote
                const ok = cfg.remote.baseUrl ? await remoteHealth(cfg.remote.baseUrl, cfg.remote.timeoutMs) : false;
                return ok ? { ok, source: "remote" } : { ok: false, source: "embedded", detail };
            }
        },
        async upsertServices(items) {
            // Only allow writes when embedded is enabled; for hybrid, we write to embedded side
            if (!cfg.embedded.enabled) {
                throw new Error('embedded catalog is disabled — write operations are not allowed');
            }
            const handle = await getEmbeddedLibHandle();
            if (handle?.upsertServices) {
                const res = await handle.upsertServices(items);
                const count = Array.isArray(res?.items) ? res.items.length : (Array.isArray(items) ? items.length : 0);
                return { ok: true, count };
            }
            // Fallback: in-memory/file backend
            // Reload current items if file store
            reloadIfNeeded();
            const now = new Date().toISOString();
            const byId = new Map();
            for (const it of embedded.items)
                byId.set(it.id, it);
            for (const raw of items || []) {
                const it = { ...raw };
                it.updatedAt = it.updatedAt || now;
                byId.set(it.id, it);
            }
            embedded.items = Array.from(byId.values());
            // Persist if file store
            if (cfg.embedded.store === 'file') {
                const p = embedded.filePath;
                if (!p)
                    throw new Error('embedded.filePath is required for file store');
                try {
                    const dir = path.dirname(p);
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(p, JSON.stringify({ items: embedded.items }, null, 2), 'utf8');
                    const st = fs.statSync(p);
                    embedded.lastLoadedAt = st.mtimeMs;
                }
                catch (e) {
                    throw new Error(`persist failed: ${String(e?.message || e)}`);
                }
            }
            return { ok: true, count: items?.length || 0 };
        },
        async deleteServices(ids) {
            if (!cfg.embedded.enabled) {
                throw new Error('embedded catalog is disabled — write operations are not allowed');
            }
            const handle = await getEmbeddedLibHandle();
            if (handle?.deleteServices) {
                const res = await handle.deleteServices(ids);
                const count = Array.isArray(res?.ids) ? res.ids.length : (Array.isArray(ids) ? ids.length : 0);
                return { ok: true, count };
            }
            // Fallback for file/memory
            reloadIfNeeded();
            const before = embedded.items.length;
            const toDelete = new Set((ids || []).filter(Boolean));
            embedded.items = embedded.items.filter((it) => !toDelete.has(it.id));
            const removed = before - embedded.items.length;
            if (cfg.embedded.store === 'file') {
                const p = embedded.filePath;
                if (!p)
                    throw new Error('embedded.filePath is required for file store');
                try {
                    const dir = path.dirname(p);
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(p, JSON.stringify({ items: embedded.items }, null, 2), 'utf8');
                    const st = fs.statSync(p);
                    embedded.lastLoadedAt = st.mtimeMs;
                }
                catch (e) {
                    throw new Error(`persist failed: ${String(e?.message || e)}`);
                }
            }
            return { ok: true, count: removed };
        },
    };
}
