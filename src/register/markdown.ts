import { z } from "zod";
import path from "node:path";
import matter from "gray-matter";
import fg from "fast-glob";
import type { ServerContext } from './context.js';
import { DEFAULT_PROJECT, resolveProject } from '../config.js';
import {
  listDocs,
  readDoc,
  createDoc,
  updateDoc,
} from '../storage/knowledge.js';
import { ensureDir, pathExists, readText, writeText } from '../fs.js';
import { promises as fsp } from 'node:fs';
import { ok, err } from '../utils/respond.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Slugify a string into a safe filename (preserve unicode where possible) */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\-\.]/g, '') // strip special chars except word, space, hyphen, dot
    .replace(/[\s_]+/g, '-')      // spaces/underscores → hyphens
    .replace(/-+/g, '-')          // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')      // trim leading/trailing hyphens
    || 'untitled';
}

/** Build a markdown file string from doc metadata + content */
function docToMarkdown(doc: { title: string; content: string; tags?: string[]; type?: string; source?: string; parentId?: string }): string {
  const fm: Record<string, unknown> = { title: doc.title };
  if (doc.tags?.length) fm.tags = doc.tags;
  if (doc.type) fm.type = doc.type;
  if (doc.source) fm.source = doc.source;
  if (doc.parentId) fm.parentId = doc.parentId;
  return matter.stringify(doc.content, fm);
}

/** Parse a markdown string with optional frontmatter into structured fields */
function parseMarkdown(raw: string): { title: string; content: string; tags: string[]; type?: string; source?: string; parentId?: string } {
  const fm = matter(raw);
  const data = fm.data as Record<string, unknown>;
  const title = (data.title as string) || 'Untitled';
  const content = fm.content.replace(/\n$/, ''); // normalize trailing newline
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const type = typeof data.type === 'string' ? data.type : undefined;
  const source = typeof data.source === 'string' ? data.source : undefined;
  const parentId = typeof data.parentId === 'string' ? data.parentId : undefined;
  return { title, content, tags, type, source, parentId };
}

const SEPARATOR = '\n\n---\n\n';

// ---------------------------------------------------------------------------
// Tool: knowledge_export_markdown
// ---------------------------------------------------------------------------

export function registerMarkdownTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "knowledge_export_markdown",
    {
      title: "Export Knowledge as Markdown Files",
      description:
        "Export knowledge docs from a project to a directory as individual .md files with frontmatter. " +
        "Each file is named by slugified title. Supports filtering by tag, type, and parentId.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        outputDir: z.string().min(1),
        tag: z.string().optional(),
        type: z.string().optional(),
        parentId: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
        dryRun: z.boolean().default(false).optional(),
      },
    },
    async ({ project, outputDir, tag, type, parentId, includeArchived, dryRun }) => {
      const prj = resolveProject(project);

      // Validate output dir early
      if (!path.isAbsolute(outputDir)) {
        return err('outputDir must be an absolute path');
      }

      const docs = await listDocs({
        project: prj,
        tag,
        includeArchived,
        includeTrashed: false,
      });

      // Apply type and parentId filters (listDocs doesn't support these natively)
      const filtered = docs.filter((d) => {
        if (type && (d as any).type !== type) return false;
        if (parentId && (d as any).parentId !== parentId) return false;
        return true;
      });

      if (dryRun) {
        const files = filtered.map((d) => {
          const slug = slugify(d.title);
          return { title: d.title, file: `${slug}.md`, id: d.id };
        });
        return ok({
          project: prj,
          outputDir,
          dryRun: true,
          count: files.length,
          files,
        });
      }

      // Write files
      const written: Array<{ id: string; title: string; file: string }> = [];
      for (const doc of filtered) {
        const full = await readDoc(prj, doc.id);
        if (!full) continue;

        const slug = slugify(full.title);
        const filename = `${slug}.md`;
        const filePath = path.join(outputDir, filename);
        const md = docToMarkdown(full);

        await ensureDir(outputDir);
        await writeText(filePath, md);
        written.push({ id: full.id, title: full.title, file: filename });
      }

      return ok({
        project: prj,
        outputDir,
        exported: written.length,
        files: written,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: knowledge_export_bundle
  // ---------------------------------------------------------------------------

  ctx.server.registerTool(
    "knowledge_export_bundle",
    {
      title: "Export Knowledge as Markdown Bundle",
      description:
        "Export knowledge docs as a single concatenated markdown string. " +
        "Docs are separated by horizontal rules with metadata headers. " +
        "Useful for LLM context windows, backups, or clipboard transfer.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        tag: z.string().optional(),
        type: z.string().optional(),
        parentId: z.string().optional(),
        includeArchived: z.boolean().default(false).optional(),
        includeFrontmatter: z.boolean().default(true).optional(),
        headingLevel: z.number().min(1).max(6).default(2).optional(),
      },
    },
    async ({ project, tag, type, parentId, includeArchived, includeFrontmatter, headingLevel }) => {
      const prj = resolveProject(project);

      const docs = await listDocs({
        project: prj,
        tag,
        includeArchived,
        includeTrashed: false,
      });

      const filtered = docs.filter((d) => {
        if (type && (d as any).type !== type) return false;
        if (parentId && (d as any).parentId !== parentId) return false;
        return true;
      });

      if (filtered.length === 0) {
        return ok({
          project: prj,
          count: 0,
          bundle: '',
        });
      }

      const level = headingLevel ?? 2;
      const hashes = '#'.repeat(level);
      const sections: string[] = [];

      for (const doc of filtered) {
        const full = await readDoc(prj, doc.id);
        if (!full) continue;

        const header = `${hashes} ${full.title}`;
        const metaLine = [
          `> **ID:** ${full.id}`,
          full.tags?.length ? `> **Tags:** ${full.tags.join(', ')}` : '',
          (full as any).type ? `> **Type:** ${(full as any).type}` : '',
          `> **Created:** ${full.createdAt}`,
          `> **Updated:** ${full.updatedAt}`,
        ].filter(Boolean).join('\n');

        const md = includeFrontmatter !== false
          ? docToMarkdown(full)
          : full.content;

        sections.push(`${header}\n\n${metaLine}\n\n${md}`);
      }

      const bundle = sections.join(SEPARATOR);

      return ok({
        project: prj,
        count: sections.length,
        chars: bundle.length,
        bundle,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: knowledge_import_markdown
  // ---------------------------------------------------------------------------

  ctx.server.registerTool(
    "knowledge_import_markdown",
    {
      title: "Import Knowledge from Markdown Directory",
      description:
        "Import .md files from a directory into the knowledge base. " +
        "Files can have YAML frontmatter (title, tags, type, source, parentId). " +
        "Supports merge strategies: append (always create new), overwrite (update existing by title), skip (ignore duplicates).",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        inputDir: z.string().min(1),
        strategy: z.enum(["append", "overwrite", "skip"]).default("overwrite").optional(),
        includePaths: z.array(z.string()).optional(),
        excludePaths: z.array(z.string()).optional(),
        tag: z.string().optional(),
        type: z.string().optional(),
        dryRun: z.boolean().default(false).optional(),
      },
    },
    async ({ project, inputDir, strategy, includePaths, excludePaths, tag, type, dryRun }) => {
      const prj = resolveProject(project);

      // Validate input dir
      if (!path.isAbsolute(inputDir)) {
        return err('inputDir must be an absolute path');
      }
      if (!(await pathExists(inputDir))) {
        return err(`inputDir does not exist: ${inputDir}`);
      }

      const strat = strategy || 'overwrite';

      // Glob .md files
      const files = await fg('**/*.md', {
        cwd: inputDir,
        dot: false,
        absolute: true,
      });

      // Filter by include/exclude patterns
      let filtered = files;
      if (includePaths?.length) {
        const relIncludes = includePaths.map((p) => {
          // Normalize to forward slashes for matching
          return p.replace(/\\/g, '/');
        });
        filtered = filtered.filter((f) => {
          const rel = path.relative(inputDir, f).replace(/\\/g, '/');
          return relIncludes.some((pat) => rel === pat || rel.startsWith(pat));
        });
      }
      if (excludePaths?.length) {
        const relExcludes = excludePaths.map((p) => p.replace(/\\/g, '/'));
        filtered = filtered.filter((f) => {
          const rel = path.relative(inputDir, f).replace(/\\/g, '/');
          return !relExcludes.some((pat) => rel === pat || rel.startsWith(pat));
        });
      }

      // Build title→id map for overwrite/skip strategies
      const existingDocs = await listDocs({ project: prj });
      const titleToId = new Map<string, string>();
      for (const d of existingDocs) {
        titleToId.set(d.title.toLowerCase(), d.id);
      }

      // Plan phase: parse all files without writing
      const planned: Array<{
        file: string;
        title: string;
        tags: string[];
        type?: string;
        source?: string;
        parentId?: string;
        action: 'create' | 'update' | 'skip';
        existingId?: string;
      }> = [];

      for (const filePath of filtered) {
        const raw = await readText(filePath);
        const parsed = parseMarkdown(raw);
        const mergedTags = [...new Set([...parsed.tags, ...(tag ? [tag] : [])])];
        const mergedType = parsed.type || type;

        const existingId = titleToId.get(parsed.title.toLowerCase());

        let action: 'create' | 'update' | 'skip';
        if (strat === 'skip' && existingId) {
          action = 'skip';
        } else if (strat === 'overwrite' && existingId) {
          action = 'update';
        } else {
          action = 'create';
        }

        planned.push({
          file: path.relative(inputDir, filePath),
          title: parsed.title,
          tags: mergedTags,
          type: mergedType,
          source: parsed.source,
          parentId: parsed.parentId,
          action,
          existingId,
        });
      }

      if (dryRun) {
        const summary = {
          total: planned.length,
          create: planned.filter((p) => p.action === 'create').length,
          update: planned.filter((p) => p.action === 'update').length,
          skip: planned.filter((p) => p.action === 'skip').length,
        };
        return ok({
          project: prj,
          inputDir,
          strategy: strat,
          dryRun: true,
          ...summary,
          files: planned,
        });
      }

      // Execute
      const results: Array<{
        file: string;
        title: string;
        action: 'create' | 'update' | 'skip';
        id?: string;
      }> = [];

      for (const plan of planned) {
        const filePath = path.join(inputDir, plan.file);
        const raw = await readText(filePath);
        const parsed = parseMarkdown(raw);

        if (plan.action === 'skip') {
          results.push({ file: plan.file, title: plan.title, action: 'skip' });
          continue;
        }

        if (plan.action === 'update' && plan.existingId) {
          const updated = await updateDoc(prj, plan.existingId, {
            title: plan.title,
            content: parsed.content,
            tags: plan.tags,
            type: plan.type,
            source: plan.source,
          });
          if (updated) {
            results.push({ file: plan.file, title: plan.title, action: 'update', id: updated.id });
          }
        } else {
          const created = await createDoc({
            project: prj,
            title: plan.title,
            content: parsed.content,
            tags: plan.tags,
            type: plan.type,
            source: plan.source,
            parentId: plan.parentId,
          });
          results.push({ file: plan.file, title: plan.title, action: 'create', id: created.id });
        }
      }

      const summary = {
        total: results.length,
        created: results.filter((r) => r.action === 'create').length,
        updated: results.filter((r) => r.action === 'update').length,
        skipped: results.filter((r) => r.action === 'skip').length,
      };

      return ok({
        project: prj,
        inputDir,
        strategy: strat,
        ...summary,
        results,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: knowledge_import_single
  // ---------------------------------------------------------------------------

  ctx.server.registerTool(
    "knowledge_import_single",
    {
      title: "Import Single Markdown Document",
      description:
        "Import a single markdown document into the knowledge base. " +
        "The markdown can contain YAML frontmatter (title, tags, type, source, parentId). " +
        "If no title is provided in frontmatter, it must be passed as a parameter.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        markdown: z.string().min(1),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        type: z.string().optional(),
        source: z.string().optional(),
        parentId: z.string().optional(),
      },
    },
    async ({ project, markdown, title, tags, type, source, parentId }) => {
      const prj = resolveProject(project);
      const parsed = parseMarkdown(markdown);

      // Override parsed values with explicit parameters
      const docTitle = title || parsed.title;
      const docTags = tags || (parsed.tags.length > 0 ? parsed.tags : undefined);
      const docType = type || parsed.type;
      const docSource = source || parsed.source;
      const docParentId = parentId || parsed.parentId;

      // Merge tags if both parsed and explicit are provided
      const mergedTags = tags && parsed.tags.length > 0
        ? [...new Set([...tags, ...parsed.tags])]
        : docTags;

      const created = await createDoc({
        project: prj,
        title: docTitle,
        content: parsed.content,
        tags: mergedTags,
        type: docType,
        source: docSource,
        parentId: docParentId,
      });

      return ok({
        id: created.id,
        title: created.title,
        project: created.project,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: knowledge_export_single
  // ---------------------------------------------------------------------------

  ctx.server.registerTool(
    "knowledge_export_single",
    {
      title: "Export Single Knowledge Doc as Markdown",
      description:
        "Export a single knowledge document as a markdown string with YAML frontmatter. " +
        "Returns the full markdown content ready for file writing or clipboard.",
      inputSchema: {
        project: z.string().default(DEFAULT_PROJECT),
        id: z.string().min(1),
        includeSystemFields: z.boolean().default(false).optional(),
      },
    },
    async ({ project, id, includeSystemFields }) => {
      const prj = resolveProject(project);
      const doc = await readDoc(prj, id);
      if (!doc) {
        return err(`Knowledge doc not found: ${project}/${id}`);
      }

      if (includeSystemFields) {
        // Include all system fields: id, project, createdAt, updatedAt, archived, trashed
        const full: Record<string, unknown> = {
          id: doc.id,
          project: doc.project,
          title: doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
        if (doc.tags?.length) full.tags = doc.tags;
        if ((doc as any).type) full.type = (doc as any).type;
        if (doc.source) full.source = doc.source;
        if ((doc as any).parentId) full.parentId = (doc as any).parentId;
        if (doc.archived) full.archived = doc.archived;
        if (doc.trashed) full.trashed = doc.trashed;
        const md = matter.stringify(doc.content, full);
        return ok({ id: doc.id, title: doc.title, markdown: md });
      }

      // Default: export with user-friendly frontmatter (no system fields)
      const md = docToMarkdown(doc);
      return ok({ id: doc.id, title: doc.title, markdown: md });
    }
  );
}
