import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import fg from 'fast-glob';
import { loadConfig, PROMPTS_DIR } from '../config.js';
import { listDocs, createDoc, updateDoc, deleteDocPermanent } from '../storage/knowledge.js';
import { listTasks, createTask, updateTask, deleteTaskPermanent } from '../storage/tasks.js';
function sanitizeTitle(s) {
    return s.replace(/[/\\:*?"<>|]/g, '_').trim() || 'untitled';
}
async function pathExists(p) {
    try {
        await fs.stat(p);
        return true;
    }
    catch {
        return false;
    }
}
async function readMarkdown(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const fm = matter(raw);
        return { frontmatter: fm.data || {}, content: (fm.content || '').trimStart() };
    }
    catch {
        return null;
    }
}
function toPosix(p) {
    return p.split(path.sep).join('/');
}
function buildPathSets(projectRoot, includePaths, excludePaths) {
    const includeSet = includePaths && includePaths.length > 0
        ? new Set(fg.sync(includePaths, { cwd: projectRoot, dot: true, onlyFiles: true })
            .map((p) => toPosix(p)))
        : undefined;
    const excludeSet = excludePaths && excludePaths.length > 0
        ? new Set(fg.sync(excludePaths, { cwd: projectRoot, dot: true, onlyFiles: true })
            .map((p) => toPosix(p)))
        : undefined;
    return { includeSet, excludeSet };
}
function passesPathFilters(relPath, includeSet, excludeSet) {
    const rp = toPosix(relPath);
    if (excludeSet && excludeSet.has(rp))
        return false;
    if (includeSet)
        return includeSet.has(rp);
    return true;
}
function arrayIntersectAny(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0)
        return false;
    const bs = new Set(b.map((x) => x.toLowerCase()));
    for (const x of a) {
        if (bs.has(String(x).toLowerCase()))
            return true;
    }
    return false;
}
function normalizeStr(x) {
    return typeof x === 'string' ? x.toLowerCase() : undefined;
}
function matchKnowledgeFilters(front, typeFromPath, opts) {
    const tags = Array.isArray(front?.tags) ? front.tags : undefined;
    const typeVal = normalizeStr(front?.type) || normalizeStr(typeFromPath);
    // excludeTags has precedence
    if (opts?.excludeTags && arrayIntersectAny(tags?.map((t) => t.toLowerCase()), opts.excludeTags.map((t) => t.toLowerCase())))
        return false;
    if (opts?.includeTags && !arrayIntersectAny(tags?.map((t) => t.toLowerCase()), opts.includeTags.map((t) => t.toLowerCase())))
        return false;
    if (opts?.includeTypes && opts.includeTypes.length > 0) {
        if (!typeVal)
            return false;
        const allow = new Set(opts.includeTypes.map((t) => t.toLowerCase()));
        if (!allow.has(typeVal))
            return false;
    }
    return true;
}
function matchTaskFilters(front, opts) {
    const tags = Array.isArray(front?.tags) ? front.tags : undefined;
    const status = normalizeStr(front?.status);
    const priority = normalizeStr(front?.priority);
    if (opts?.excludeTags && arrayIntersectAny(tags?.map((t) => t.toLowerCase()), opts.excludeTags.map((t) => t.toLowerCase())))
        return false;
    if (opts?.includeTags && !arrayIntersectAny(tags?.map((t) => t.toLowerCase()), opts.includeTags.map((t) => t.toLowerCase())))
        return false;
    if (opts?.includeStatus && opts.includeStatus.length > 0) {
        const allow = new Set(opts.includeStatus.map((s) => s.toLowerCase()));
        if (!status || !allow.has(status))
            return false;
    }
    if (opts?.includePriority && opts.includePriority.length > 0) {
        const allow = new Set(opts.includePriority.map((p) => p.toLowerCase()));
        if (!priority || !allow.has(priority))
            return false;
    }
    return true;
}
export async function planImportProjectFromVault(project, opts) {
    const cfg = loadConfig();
    const vaultRoot = cfg.obsidian.vaultRoot;
    const pfx = project || '';
    const projectRoot = path.join(vaultRoot, pfx ? pfx : '');
    const doKnowledge = opts?.knowledge !== false;
    const doTasks = opts?.tasks !== false;
    const doPrompts = opts?.prompts !== false;
    const strategy = opts?.strategy || 'merge';
    // Back-compat: derive mergeStrategy from overwriteByTitle when not provided
    const mergeStrategy = (() => {
        if (opts?.mergeStrategy)
            return opts.mergeStrategy;
        if (strategy === 'merge')
            return (opts?.overwriteByTitle !== false) ? 'overwrite' : 'skip';
        return 'overwrite';
    })();
    const overwrite = strategy === 'merge' ? (mergeStrategy === 'overwrite') : true;
    const existingDocs = doKnowledge ? await listDocs({ project }) : [];
    const existingTasks = doTasks ? await listTasks({ project }) : [];
    const existingDocsByTitle = new Map();
    const existingTasksByTitle = new Map();
    for (const m of existingDocs)
        existingDocsByTitle.set(m.title, m.id);
    for (const t of existingTasks)
        existingTasksByTitle.set(t.title, t.id);
    const { includeSet, excludeSet } = buildPathSets(projectRoot, opts?.includePaths, opts?.excludePaths);
    const plan = {
        deletes: { knowledge: 0, tasks: 0 },
        creates: { knowledge: 0, tasks: 0 },
        updates: { knowledge: 0, tasks: 0 },
        conflicts: { knowledge: 0, tasks: 0, sampleTitles: { knowledge: [], tasks: [] } },
    };
    if (strategy === 'replace') {
        if (doKnowledge)
            plan.deletes.knowledge = existingDocs.length;
        if (doTasks)
            plan.deletes.tasks = existingTasks.length;
        // In replace strategy we remove all existing first; the subsequent import will create fresh items.
        // Therefore, the dryRun plan should not count updates based on existing title collisions.
        // Clear maps so traversal plans only 'creates' for all matching vault items.
        existingDocsByTitle.clear();
        existingTasksByTitle.clear();
    }
    // Knowledge
    if (doKnowledge) {
        const knowledgeDir = path.join(projectRoot, 'Knowledge');
        if (await pathExists(knowledgeDir)) {
            async function walkKnowledge(dir, parentId) {
                const indexPath = path.join(dir, 'INDEX.md');
                const relIndex = toPosix(path.relative(projectRoot, indexPath));
                if (await pathExists(indexPath) && passesPathFilters(relIndex, includeSet, excludeSet)) {
                    const md = await readMarkdown(indexPath);
                    if (md && matchKnowledgeFilters(md.frontmatter, path.basename(path.dirname(dir)), opts)) {
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(dir));
                        if (existingDocsByTitle.has(inferredTitle)) {
                            // Track conflicts regardless of chosen behavior
                            plan.conflicts.knowledge++;
                            if (plan.conflicts.sampleTitles.knowledge.length < 10)
                                plan.conflicts.sampleTitles.knowledge.push(inferredTitle);
                            if (mergeStrategy === 'overwrite') {
                                plan.updates.knowledge++;
                            }
                            else if (mergeStrategy === 'append') {
                                plan.creates.knowledge++;
                            } // skip/fail => no creates/updates planned here
                        }
                        else {
                            plan.creates.knowledge++;
                            if (!existingDocsByTitle.has(inferredTitle))
                                existingDocsByTitle.set(inferredTitle, 'planned');
                        }
                    }
                }
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walkKnowledge(full, parentId);
                    }
                    else if (entry.isFile()) {
                        if (!entry.name.endsWith('.md'))
                            continue;
                        if (entry.name === 'INDEX.md')
                            continue;
                        const rel = toPosix(path.relative(projectRoot, full));
                        if (!passesPathFilters(rel, includeSet, excludeSet))
                            continue;
                        const md = await readMarkdown(full);
                        if (!md)
                            continue;
                        if (!matchKnowledgeFilters(md.frontmatter, path.basename(path.dirname(dir)), opts))
                            continue;
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(entry.name, '.md'));
                        if (existingDocsByTitle.has(inferredTitle)) {
                            plan.conflicts.knowledge++;
                            if (plan.conflicts.sampleTitles.knowledge.length < 10)
                                plan.conflicts.sampleTitles.knowledge.push(inferredTitle);
                            if (mergeStrategy === 'overwrite') {
                                plan.updates.knowledge++;
                            }
                            else if (mergeStrategy === 'append') {
                                plan.creates.knowledge++;
                            }
                        }
                        else {
                            plan.creates.knowledge++;
                            if (!existingDocsByTitle.has(inferredTitle))
                                existingDocsByTitle.set(inferredTitle, 'planned');
                        }
                    }
                }
            }
            await walkKnowledge(knowledgeDir, null);
        }
    }
    // Tasks
    if (doTasks) {
        const tasksDir = path.join(projectRoot, 'Tasks');
        if (await pathExists(tasksDir)) {
            async function walkTasks(dir, parentId) {
                const indexPath = path.join(dir, 'INDEX.md');
                const relIndex = toPosix(path.relative(projectRoot, indexPath));
                if (await pathExists(indexPath) && passesPathFilters(relIndex, includeSet, excludeSet)) {
                    const md = await readMarkdown(indexPath);
                    if (md && matchTaskFilters(md.frontmatter, opts)) {
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(dir));
                        if (existingTasksByTitle.has(inferredTitle)) {
                            plan.conflicts.tasks++;
                            if (plan.conflicts.sampleTitles.tasks.length < 10)
                                plan.conflicts.sampleTitles.tasks.push(inferredTitle);
                            if (mergeStrategy === 'overwrite') {
                                plan.updates.tasks++;
                            }
                            else if (mergeStrategy === 'append') {
                                plan.creates.tasks++;
                            }
                        }
                        else {
                            plan.creates.tasks++;
                            if (!existingTasksByTitle.has(inferredTitle))
                                existingTasksByTitle.set(inferredTitle, 'planned');
                        }
                    }
                }
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walkTasks(full, parentId);
                    }
                    else if (entry.isFile()) {
                        if (!entry.name.endsWith('.md'))
                            continue;
                        if (entry.name === 'INDEX.md')
                            continue;
                        const rel = toPosix(path.relative(projectRoot, full));
                        if (!passesPathFilters(rel, includeSet, excludeSet))
                            continue;
                        const md = await readMarkdown(full);
                        if (!md)
                            continue;
                        if (!matchTaskFilters(md.frontmatter, opts))
                            continue;
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(entry.name, '.md'));
                        if (existingTasksByTitle.has(inferredTitle)) {
                            plan.conflicts.tasks++;
                            if (plan.conflicts.sampleTitles.tasks.length < 10)
                                plan.conflicts.sampleTitles.tasks.push(inferredTitle);
                            if (mergeStrategy === 'overwrite') {
                                plan.updates.tasks++;
                            }
                            else if (mergeStrategy === 'append') {
                                plan.creates.tasks++;
                            }
                        }
                        else {
                            plan.creates.tasks++;
                            if (!existingTasksByTitle.has(inferredTitle))
                                existingTasksByTitle.set(inferredTitle, 'planned');
                        }
                    }
                }
            }
            const rootEntries = await fs.readdir(tasksDir, { withFileTypes: true });
            for (const e of rootEntries) {
                if (e.isDirectory())
                    await walkTasks(path.join(tasksDir, e.name), null);
            }
        }
    }
    // Prompts (file-level copy plan)
    if (doPrompts) {
        const promptsRoot = path.join(projectRoot, 'Prompts');
        const includeSources = opts?.importPromptSourcesJson === true; // opt-in
        const includeMarkdown = opts?.importPromptMarkdown === true; // opt-in
        const willCopy = { sources: 0, builds: 0, markdown: 0, catalog: 0 };
        const willDeleteDirs = [];
        if (await pathExists(promptsRoot)) {
            // sources
            if (includeSources) {
                const patterns = [
                    'sources/prompts/**/*.json',
                    'sources/rules/**/*.json',
                    'sources/workflows/**/*.json',
                    'sources/templates/**/*.json',
                    'sources/policies/**/*.json',
                ];
                const files = fg.sync(patterns, { cwd: promptsRoot, dot: false, onlyFiles: true });
                willCopy.sources = files.length;
            }
            // builds
            {
                const files = fg.sync(['builds/**/*.*'], { cwd: promptsRoot, dot: false, onlyFiles: true });
                willCopy.builds = files.length;
            }
            // markdown
            if (includeMarkdown) {
                const files = fg.sync(['markdown/**/*.md'], { cwd: promptsRoot, dot: false, onlyFiles: true });
                willCopy.markdown = files.length;
            }
            // catalog
            {
                const files = fg.sync(['catalog/**/*.json'], { cwd: promptsRoot, dot: false, onlyFiles: true });
                willCopy.catalog = files.length;
            }
        }
        if (strategy === 'replace') {
            const destBase = path.join(PROMPTS_DIR, project || 'mcp');
            willDeleteDirs.push(path.join(destBase, 'exports', 'builds'), path.join(destBase, 'exports', 'markdown'), path.join(destBase, 'exports', 'catalog'));
            if (includeSources) {
                willDeleteDirs.push(path.join(destBase, 'prompts'), path.join(destBase, 'rules'), path.join(destBase, 'workflows'), path.join(destBase, 'templates'), path.join(destBase, 'policies'));
            }
        }
        plan.prompts = { willCopy, willDeleteDirs: strategy === 'replace' ? willDeleteDirs : undefined };
    }
    return plan;
}
export async function importProjectFromVault(project, opts) {
    const cfg = loadConfig();
    const vaultRoot = cfg.obsidian.vaultRoot;
    const pfx = project || '';
    const projectRoot = path.join(vaultRoot, pfx ? pfx : '');
    const doKnowledge = opts?.knowledge !== false;
    const doTasks = opts?.tasks !== false;
    const doPrompts = opts?.prompts !== false;
    const strategy = opts?.strategy || 'merge';
    const mergeStrategy = (() => {
        if (opts?.mergeStrategy)
            return opts.mergeStrategy;
        if (strategy === 'merge')
            return (opts?.overwriteByTitle !== false) ? 'overwrite' : 'skip';
        return 'overwrite';
    })();
    const overwrite = strategy === 'merge' ? (mergeStrategy === 'overwrite') : true;
    const { includeSet, excludeSet } = buildPathSets(projectRoot, opts?.includePaths, opts?.excludePaths);
    if (strategy === 'replace') {
        if (doKnowledge) {
            const metas = await listDocs({ project });
            for (const m of metas)
                await deleteDocPermanent(m.project, m.id);
        }
        if (doTasks) {
            const tasks = await listTasks({ project });
            for (const t of tasks)
                await deleteTaskPermanent(t.project, t.id);
        }
    }
    // Pre-scan: if mergeStrategy is 'fail' and there are conflicts, abort early before any writes
    if (strategy === 'merge' && mergeStrategy === 'fail') {
        const plan = await planImportProjectFromVault(project, { ...opts, mergeStrategy });
        const kConf = plan.conflicts?.knowledge || 0;
        const tConf = plan.conflicts?.tasks || 0;
        if (kConf + tConf > 0) {
            const examplesK = plan.conflicts?.sampleTitles?.knowledge || [];
            const examplesT = plan.conflicts?.sampleTitles?.tasks || [];
            const samples = [
                examplesK.length ? `knowledge: ${examplesK.join(', ')}` : '',
                examplesT.length ? `tasks: ${examplesT.join(', ')}` : '',
            ].filter(Boolean).join(' | ');
            throw new Error(`Import aborted due to ${kConf + tConf} title conflicts (mergeStrategy=fail). ${samples ? 'Examples — ' + samples : ''}`);
        }
    }
    const existingDocsByTitle = new Map();
    const existingTasksByTitle = new Map();
    if (doKnowledge) {
        const metas = await listDocs({ project });
        for (const m of metas)
            existingDocsByTitle.set(m.title, m.id);
    }
    if (doTasks) {
        const tasks = await listTasks({ project });
        for (const t of tasks)
            existingTasksByTitle.set(t.title, t.id);
    }
    let knowledgeImported = 0;
    let tasksImported = 0;
    const promptsCopied = { sources: 0, builds: 0, markdown: 0, catalog: 0 };
    // Knowledge
    if (doKnowledge) {
        const knowledgeDir = path.join(projectRoot, 'Knowledge');
        if (await pathExists(knowledgeDir)) {
            async function importKnowledgeFolder(dir, parentId) {
                let currentParentId = parentId;
                const indexPath = path.join(dir, 'INDEX.md');
                if (await pathExists(indexPath)) {
                    const relIndex = toPosix(path.relative(projectRoot, indexPath));
                    if (passesPathFilters(relIndex, includeSet, excludeSet)) {
                        const md = await readMarkdown(indexPath);
                        if (md && matchKnowledgeFilters(md.frontmatter, path.basename(path.dirname(dir)), opts)) {
                            const titleFromFM = md.frontmatter?.title;
                            const inferredTitle = titleFromFM || sanitizeTitle(path.basename(dir));
                            const typeVal = md.frontmatter?.type || path.basename(path.dirname(dir));
                            const tags = Array.isArray(md.frontmatter?.tags) ? md.frontmatter.tags : undefined;
                            const source = typeof md.frontmatter?.source === 'string' ? md.frontmatter.source : undefined;
                            if (existingDocsByTitle.has(inferredTitle)) {
                                if (mergeStrategy === 'overwrite') {
                                    const id = existingDocsByTitle.get(inferredTitle);
                                    const updated = await updateDoc(project || 'default', id, {
                                        title: inferredTitle,
                                        content: md.content,
                                        tags,
                                        source,
                                        parentId: parentId || undefined,
                                        type: typeVal,
                                    });
                                    currentParentId = updated?.id || id;
                                }
                                else if (mergeStrategy === 'append') {
                                    const created = await createDoc({
                                        project: project || 'default',
                                        title: inferredTitle,
                                        content: md.content,
                                        tags,
                                        source,
                                        parentId: parentId || undefined,
                                        type: typeVal,
                                    });
                                    knowledgeImported++;
                                    existingDocsByTitle.set(created.title, created.id);
                                    currentParentId = created.id;
                                }
                                else if (mergeStrategy === 'fail') {
                                    throw new Error(`Title conflict (knowledge): ${inferredTitle}`);
                                } // skip => do nothing
                            }
                            else {
                                const created = await createDoc({
                                    project: project || 'default',
                                    title: inferredTitle,
                                    content: md.content,
                                    tags,
                                    source,
                                    parentId: parentId || undefined,
                                    type: typeVal,
                                });
                                knowledgeImported++;
                                existingDocsByTitle.set(created.title, created.id);
                                currentParentId = created.id;
                            }
                        }
                    }
                }
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await importKnowledgeFolder(full, currentParentId);
                    }
                    else if (entry.isFile()) {
                        if (!entry.name.endsWith('.md'))
                            continue;
                        if (entry.name === 'INDEX.md')
                            continue;
                        const rel = toPosix(path.relative(projectRoot, full));
                        if (!passesPathFilters(rel, includeSet, excludeSet))
                            continue;
                        const md = await readMarkdown(full);
                        if (!md)
                            continue;
                        if (!matchKnowledgeFilters(md.frontmatter, path.basename(path.dirname(dir)), opts))
                            continue;
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(entry.name, '.md'));
                        const typeVal = md.frontmatter?.type || path.basename(path.dirname(dir));
                        const tags = Array.isArray(md.frontmatter?.tags) ? md.frontmatter.tags : undefined;
                        const source = typeof md.frontmatter?.source === 'string' ? md.frontmatter.source : undefined;
                        if (existingDocsByTitle.has(inferredTitle)) {
                            if (mergeStrategy === 'overwrite') {
                                const id = existingDocsByTitle.get(inferredTitle);
                                await updateDoc(project || 'default', id, {
                                    title: inferredTitle,
                                    content: md.content,
                                    tags,
                                    source,
                                    parentId: currentParentId || undefined,
                                    type: typeVal,
                                });
                            }
                            else if (mergeStrategy === 'append') {
                                const created = await createDoc({
                                    project: project || 'default',
                                    title: inferredTitle,
                                    content: md.content,
                                    tags,
                                    source,
                                    parentId: currentParentId || undefined,
                                    type: typeVal,
                                });
                                knowledgeImported++;
                                existingDocsByTitle.set(created.title, created.id);
                            }
                            else if (mergeStrategy === 'fail') {
                                throw new Error(`Title conflict (knowledge): ${inferredTitle}`);
                            }
                        }
                        else {
                            const created = await createDoc({
                                project: project || 'default',
                                title: inferredTitle,
                                content: md.content,
                                tags,
                                source,
                                parentId: currentParentId || undefined,
                                type: typeVal,
                            });
                            knowledgeImported++;
                            existingDocsByTitle.set(created.title, created.id);
                        }
                    }
                }
            }
            await importKnowledgeFolder(knowledgeDir, null);
        }
    }
    // Tasks
    if (doTasks) {
        const tasksDir = path.join(projectRoot, 'Tasks');
        if (await pathExists(tasksDir)) {
            async function importTaskFolder(dir, parentId) {
                let currentParentId = parentId;
                const indexPath = path.join(dir, 'INDEX.md');
                if (await pathExists(indexPath)) {
                    const relIndex = toPosix(path.relative(projectRoot, indexPath));
                    if (passesPathFilters(relIndex, includeSet, excludeSet)) {
                        const md = await readMarkdown(indexPath);
                        if (md && matchTaskFilters(md.frontmatter, opts)) {
                            const titleFromFM = md.frontmatter?.title;
                            const inferredTitle = titleFromFM || sanitizeTitle(path.basename(dir));
                            const status = md.frontmatter?.status;
                            const priority = md.frontmatter?.priority;
                            const tags = Array.isArray(md.frontmatter?.tags) ? md.frontmatter.tags : undefined;
                            const links = Array.isArray(md.frontmatter?.links) ? md.frontmatter.links : undefined;
                            const description = md.content;
                            if (existingTasksByTitle.has(inferredTitle)) {
                                if (mergeStrategy === 'overwrite') {
                                    const id = existingTasksByTitle.get(inferredTitle);
                                    const updated = await updateTask(project || 'default', id, {
                                        title: inferredTitle,
                                        description,
                                        priority: priority || undefined,
                                        tags,
                                        links,
                                        parentId: parentId || undefined,
                                        status: status || undefined,
                                    });
                                    currentParentId = updated?.id || id;
                                }
                                else if (mergeStrategy === 'append') {
                                    const created = await createTask({
                                        project: project || 'default',
                                        title: inferredTitle,
                                        description,
                                        priority: priority || undefined,
                                        tags,
                                        links,
                                        parentId: parentId || undefined,
                                    });
                                    currentParentId = created.id;
                                    tasksImported++;
                                    existingTasksByTitle.set(created.title, created.id);
                                }
                                else if (mergeStrategy === 'fail') {
                                    throw new Error(`Title conflict (task): ${inferredTitle}`);
                                }
                            }
                            else {
                                const created = await createTask({
                                    project: project || 'default',
                                    title: inferredTitle,
                                    description,
                                    priority: priority || undefined,
                                    tags,
                                    links,
                                    parentId: parentId || undefined,
                                });
                                currentParentId = created.id;
                                tasksImported++;
                                existingTasksByTitle.set(created.title, created.id);
                            }
                        }
                    }
                }
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await importTaskFolder(full, currentParentId);
                    }
                    else if (entry.isFile()) {
                        if (!entry.name.endsWith('.md'))
                            continue;
                        if (entry.name === 'INDEX.md')
                            continue;
                        const rel = toPosix(path.relative(projectRoot, full));
                        if (!passesPathFilters(rel, includeSet, excludeSet))
                            continue;
                        const md = await readMarkdown(full);
                        if (!md)
                            continue;
                        if (!matchTaskFilters(md.frontmatter, opts))
                            continue;
                        const titleFromFM = md.frontmatter?.title;
                        const inferredTitle = titleFromFM || sanitizeTitle(path.basename(entry.name, '.md'));
                        const status = md.frontmatter?.status;
                        const priority = md.frontmatter?.priority;
                        const tags = Array.isArray(md.frontmatter?.tags) ? md.frontmatter.tags : undefined;
                        const links = Array.isArray(md.frontmatter?.links) ? md.frontmatter.links : undefined;
                        const description = md.content;
                        if (existingTasksByTitle.has(inferredTitle)) {
                            if (mergeStrategy === 'overwrite') {
                                const id = existingTasksByTitle.get(inferredTitle);
                                await updateTask(project || 'default', id, {
                                    title: inferredTitle,
                                    description,
                                    priority: priority || undefined,
                                    tags,
                                    links,
                                    parentId: currentParentId || undefined,
                                    status: status || undefined,
                                });
                            }
                            else if (mergeStrategy === 'append') {
                                const created = await createTask({
                                    project: project || 'default',
                                    title: inferredTitle,
                                    description,
                                    priority: priority || undefined,
                                    tags,
                                    links,
                                    parentId: currentParentId || undefined,
                                });
                                tasksImported++;
                                existingTasksByTitle.set(created.title, created.id);
                            }
                            else if (mergeStrategy === 'fail') {
                                throw new Error(`Title conflict (task): ${inferredTitle}`);
                            }
                        }
                        else {
                            const created = await createTask({
                                project: project || 'default',
                                title: inferredTitle,
                                description,
                                priority: priority || undefined,
                                tags,
                                links,
                                parentId: currentParentId || undefined,
                            });
                            tasksImported++;
                            existingTasksByTitle.set(created.title, created.id);
                        }
                    }
                }
            }
            const rootEntries = await fs.readdir(tasksDir, { withFileTypes: true });
            for (const e of rootEntries) {
                if (e.isDirectory())
                    await importTaskFolder(path.join(tasksDir, e.name), null);
            }
        }
    }
    // Prompts copy
    if (doPrompts) {
        const promptsRoot = path.join(projectRoot, 'Prompts');
        const includeSources = opts?.importPromptSourcesJson === true;
        const includeMarkdown = opts?.importPromptMarkdown === true;
        if (await pathExists(promptsRoot)) {
            const destBase = path.join(PROMPTS_DIR, project || 'mcp');
            async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
            // Replace cleanup
            if (strategy === 'replace') {
                const toDelete = [
                    path.join(destBase, 'exports', 'builds'),
                    path.join(destBase, 'exports', 'markdown'),
                    path.join(destBase, 'exports', 'catalog'),
                ];
                if (includeSources) {
                    toDelete.push(path.join(destBase, 'prompts'), path.join(destBase, 'rules'), path.join(destBase, 'workflows'), path.join(destBase, 'templates'), path.join(destBase, 'policies'));
                }
                for (const d of toDelete) {
                    try {
                        await fs.rm(d, { recursive: true, force: true });
                    }
                    catch { }
                }
            }
            // Copy helpers
            async function copyTree(src, dst, pattern) {
                const files = await fg(pattern, { cwd: src, dot: false, onlyFiles: true });
                await ensureDir(dst);
                for (const rel of files) {
                    const from = path.join(src, rel);
                    const to = path.join(dst, rel);
                    await ensureDir(path.dirname(to));
                    await fs.copyFile(from, to);
                }
                return files.length;
            }
            // sources (opt-in)
            if (includeSources) {
                const srcRoot = path.join(promptsRoot, 'sources');
                const count = await copyTree(srcRoot, destBase, '**/*.json');
                promptsCopied.sources += count;
            }
            // builds
            {
                const srcRoot = path.join(promptsRoot, 'builds');
                const dstRoot = path.join(destBase, 'exports', 'builds');
                const count = await copyTree(srcRoot, dstRoot, '**/*.*');
                promptsCopied.builds += count;
            }
            // markdown (opt-in)
            if (includeMarkdown) {
                const srcRoot = path.join(promptsRoot, 'markdown');
                const dstRoot = path.join(destBase, 'exports', 'markdown');
                const count = await copyTree(srcRoot, dstRoot, '**/*.md');
                promptsCopied.markdown += count;
            }
            // catalog
            {
                const srcRoot = path.join(promptsRoot, 'catalog');
                const dstRoot = path.join(destBase, 'exports', 'catalog');
                const count = await copyTree(srcRoot, dstRoot, '**/*.json');
                promptsCopied.catalog += count;
            }
        }
    }
    return { project, vaultRoot, knowledgeImported, tasksImported, promptsCopied };
}
