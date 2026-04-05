import { z } from "zod";
import type { ServerContext } from './context.js';
import { loadConfig, resolveProject } from '../config.js';
import { exportProjectToVault, planExportProjectToVault } from '../obsidian/export.js';
import { importProjectFromVault, planImportProjectFromVault } from '../obsidian/import.js';
import { ok, err } from '../utils/respond.js';

export function registerObsidianTools(ctx: ServerContext): void {
  ctx.server.registerTool(
    "obsidian_export_project",
    {
      title: "Export Project to Obsidian Vault",
      description: "Export knowledge, tasks, and prompts to Obsidian vault (merge or replace). Use with caution in replace mode.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
        prompts: z.boolean().optional(),
        includePromptSourcesJson: z.boolean().optional(),
        includePromptSourcesMd: z.boolean().optional(),
        strategy: z.enum(["merge", "replace"]).optional(),
        includeArchived: z.boolean().optional(),
        updatedFrom: z.string().optional(),
        updatedTo: z.string().optional(),
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        includeTypes: z.array(z.string()).optional(),
        excludeTypes: z.array(z.string()).optional(),
        includeStatus: z.array(z.enum(["pending", "in_progress", "completed", "closed"])).optional(),
        includePriority: z.array(z.enum(["low", "medium", "high"])).optional(),
        keepOrphans: z.boolean().optional(),
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, knowledge, tasks, prompts, includePromptSourcesJson, includePromptSourcesMd, strategy, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans, confirm, dryRun }) => {
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const doPrompts = prompts !== false;
      const strat = strategy || 'merge';

      if (dryRun) {
        const plan = await planExportProjectToVault(prj, {
          knowledge: doKnowledge,
          tasks: doTasks,
          prompts: doPrompts,
          strategy: strat,
          includeArchived,
          updatedFrom,
          updatedTo,
          includeTags,
          excludeTags,
          includeTypes,
          excludeTypes,
          includeStatus,
          includePriority,
          keepOrphans,
        });
        return ok({
          project: prj,
          strategy: strat,
          knowledge: doKnowledge,
          tasks: doTasks,
          prompts: doPrompts,
          plan: {
            willWrite: { knowledgeCount: plan.knowledgeCount, tasksCount: plan.tasksCount, promptsCount: plan.promptsCount },
            willDeleteDirs: plan.willDeleteDirs,
          },
        });
      }

      if (strat === 'replace' && confirm !== true) {
        return err('Export replace not confirmed: pass confirm=true to proceed');
      }

      try {
        const result = await exportProjectToVault(prj, { knowledge: doKnowledge, tasks: doTasks, prompts: doPrompts, includePromptSourcesJson, includePromptSourcesMd, strategy: strat, includeArchived, updatedFrom, updatedTo, includeTags, excludeTags, includeTypes, excludeTypes, includeStatus, includePriority, keepOrphans });
        return ok(result);
      } catch (e: any) {
        return err(String(e?.message || e));
      }
    }
  );

  ctx.server.registerTool(
    "obsidian_import_project",
    {
      title: "Import Project from Obsidian Vault",
      description: "Import knowledge, tasks, and prompts from Obsidian vault. Replace strategy deletes existing content — use with caution.",
      inputSchema: {
        project: z.string().optional(),
        knowledge: z.boolean().optional(),
        tasks: z.boolean().optional(),
        prompts: z.boolean().optional(),
        importPromptSourcesJson: z.boolean().optional(),
        importPromptMarkdown: z.boolean().optional(),
        overwriteByTitle: z.boolean().optional(),
        strategy: z.enum(["merge", "replace"]).optional(),
        mergeStrategy: z.enum(["overwrite", "append", "skip", "fail"]).optional(),
        includePaths: z.array(z.string()).optional(),
        excludePaths: z.array(z.string()).optional(),
        includeTags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
        includeTypes: z.array(z.string()).optional(),
        includeStatus: z.array(z.enum(["pending", "in_progress", "completed", "closed"])).optional(),
        includePriority: z.array(z.enum(["low", "medium", "high"])).optional(),
        confirm: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, knowledge, tasks, prompts, importPromptSourcesJson, importPromptMarkdown, overwriteByTitle, strategy, mergeStrategy, includePaths, excludePaths, includeTags, excludeTags, includeTypes, includeStatus, includePriority, confirm, dryRun }) => {
      const cfg = loadConfig();
      const prj = resolveProject(project);
      const doKnowledge = knowledge !== false;
      const doTasks = tasks !== false;
      const doPrompts = prompts !== false;
      const strat = strategy || 'merge';
      const mstrat = mergeStrategy || 'overwrite';

      const commonOpts = {
        knowledge: doKnowledge,
        tasks: doTasks,
        prompts: doPrompts,
        importPromptSourcesJson,
        importPromptMarkdown,
        overwriteByTitle,
        strategy: strat as 'merge' | 'replace',
        mergeStrategy: mstrat as 'overwrite' | 'append' | 'skip' | 'fail',
        includePaths,
        excludePaths,
        includeTags,
        excludeTags,
        includeTypes,
        includeStatus,
        includePriority,
      } as const;

      if (dryRun) {
        try {
          const plan = await planImportProjectFromVault(prj, commonOpts as any);
          return ok({
            project: prj,
            strategy: strat,
            mergeStrategy: mstrat,
            knowledge: doKnowledge,
            tasks: doTasks,
            prompts: doPrompts,
            plan,
          });
        } catch (e: any) {
          return err(String(e?.message || e));
        }
      }

      if (strat === 'replace' && confirm !== true) {
        return err('Import replace not confirmed: pass confirm=true to proceed');
      }

      try {
        const result = await importProjectFromVault(prj, commonOpts as any);
        return ok(result);
      } catch (e: any) {
        return err(String(e?.message || e));
      }
    }
  );
}
