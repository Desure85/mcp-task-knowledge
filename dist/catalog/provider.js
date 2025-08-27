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
    return {
        mode: cfg.mode,
        async queryServices(q) {
            // Currently only remote implemented; embedded to be wired when core is packaged
            const tryRemote = async () => {
                if (!cfg.remote.enabled || !cfg.remote.baseUrl)
                    throw new Error("remote disabled");
                return remoteQuery(cfg.remote.baseUrl, q, cfg.remote.timeoutMs);
            };
            const tryEmbedded = async () => {
                throw new Error("embedded service-catalog is not wired yet");
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
                // no embedded impl yet
                return { ok: false, source: "embedded", detail: "not wired" };
            }
            // hybrid: probe preferred first, then fallback
            if (useRemotePreferred) {
                const ok = cfg.remote.baseUrl ? await remoteHealth(cfg.remote.baseUrl, cfg.remote.timeoutMs) : false;
                if (ok)
                    return { ok, source: "remote" };
                return { ok: false, source: "embedded", detail: "not wired" };
            }
            else {
                // if embedded were available, we'd check it here
                const ok = cfg.remote.baseUrl ? await remoteHealth(cfg.remote.baseUrl, cfg.remote.timeoutMs) : false;
                return ok ? { ok, source: "remote" } : { ok: false, source: "embedded", detail: "not wired" };
            }
        },
    };
}
