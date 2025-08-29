import path from 'node:path';
import fs from 'node:fs/promises';
import { PROMPTS_DIR, resolveProject } from '../config.js';
export async function ensureMetricsDirs(project) {
    const prj = resolveProject(project);
    const base = path.join(PROMPTS_DIR, prj, 'metrics');
    const eventsDir = path.join(base, 'events');
    const aggrDir = path.join(base, 'aggregates');
    const assignDir = path.join(base, 'assignments');
    await fs.mkdir(eventsDir, { recursive: true });
    await fs.mkdir(aggrDir, { recursive: true });
    await fs.mkdir(assignDir, { recursive: true });
    return { base, eventsDir, aggrDir, assignDir };
}
function dayStamp(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
export async function appendEvents(project, promptKey, items) {
    const prj = resolveProject(project);
    const { eventsDir } = await ensureMetricsDirs(prj);
    const file = path.join(eventsDir, `${promptKey}.${dayStamp()}.jsonl`);
    const lines = items.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(file, lines, 'utf8');
}
export async function readAggregates(project, promptKey) {
    const prj = resolveProject(project);
    const { aggrDir } = await ensureMetricsDirs(prj);
    const file = path.join(aggrDir, `${promptKey}.aggregates.json`);
    try {
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export async function writeAggregates(project, promptKey, aggr) {
    const prj = resolveProject(project);
    const { aggrDir } = await ensureMetricsDirs(prj);
    const file = path.join(aggrDir, `${promptKey}.aggregates.json`);
    await fs.writeFile(file, JSON.stringify(aggr, null, 2), 'utf8');
}
export async function updateAggregates(project, promptKey, items) {
    const aggr = await readAggregates(project, promptKey);
    for (const e of items) {
        const key = e.variantId;
        if (!aggr[key]) {
            aggr[key] = { trials: 0, successes: 0, scoreSum: 0, latencySumMs: 0, costSum: 0, tokensInSum: 0, tokensOutSum: 0 };
        }
        const s = aggr[key];
        s.trials += 1;
        if (e.outcome.success)
            s.successes += 1;
        if (typeof e.outcome.score === 'number')
            s.scoreSum += e.outcome.score;
        if (typeof e.outcome.latencyMs === 'number')
            s.latencySumMs += e.outcome.latencyMs;
        if (typeof e.outcome.cost === 'number')
            s.costSum += e.outcome.cost;
        if (typeof e.outcome.tokensIn === 'number')
            s.tokensInSum += e.outcome.tokensIn;
        if (typeof e.outcome.tokensOut === 'number')
            s.tokensOutSum += e.outcome.tokensOut;
    }
    await writeAggregates(project, promptKey, aggr);
    return aggr;
}
export async function appendAssignments(project, items) {
    const prj = resolveProject(project);
    const { assignDir } = await ensureMetricsDirs(prj);
    const file = path.join(assignDir, `${dayStamp()}.jsonl`);
    const lines = items.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(file, lines, 'utf8');
}
export async function readExperiment(project, promptKey) {
    const prj = resolveProject(project);
    const file = path.join(PROMPTS_DIR, prj, 'metrics', 'experiments', `${promptKey}.json`);
    try {
        const raw = await fs.readFile(file, 'utf8');
        const j = JSON.parse(raw);
        const arr = Array.isArray(j?.variants) ? j.variants.filter((x) => typeof x === 'string' && x.trim()) : [];
        return arr.length ? { variants: arr, params: j?.params } : null;
    }
    catch {
        return null;
    }
}
export async function listBuildVariants(project, promptKey) {
    const prj = resolveProject(project);
    const buildsDir = path.join(PROMPTS_DIR, prj, 'exports', 'builds');
    try {
        const items = await fs.readdir(buildsDir);
        // Heuristic: accept exact match and prefixed variants like key--variant.json or key.variant.json
        const base = promptKey.toLowerCase();
        const names = items.filter((n) => n.toLowerCase().endsWith('.json'));
        const matched = names
            .filter((n) => {
            const b = n.slice(0, -5).toLowerCase();
            return b === base || b.startsWith(base + '.') || b.startsWith(base + '--');
        })
            .map((n) => n.slice(0, -5));
        if (matched.length > 0)
            return matched;
        // fallback: if build exists exactly `promptKey.json`, return [promptKey]
        if (names.includes(`${promptKey}.json`))
            return [promptKey];
        return [];
    }
    catch {
        return [];
    }
}
