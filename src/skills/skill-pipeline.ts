/**
 * skills/skill-pipeline.ts — Skill invocation pipeline (SK-002).
 *
 * Pipeline: trigger → context → execution → result.
 * - Trigger: match a request message against skill triggers/frontmatter.
 * - Context: named $ARGUMENTS + ${VARS} variables, fork metadata.
 * - Execution: render the skill body, optionally running `!command` shell lines.
 * - Result: rendered output with diagnostics.
 *
 * Shell execution (`!command`) is DISABLED by default (allowShell: false).
 * `context: fork` skills produce a self-contained subagent task instead of
 * executing inline.
 *
 * Usage:
 *   const pipe = new SkillPipeline(manager);
 *   const matches = pipe.match('run a code review please');
 *   const result = await pipe.invoke('code-review', {
 *     arguments: { files: 'src/' },
 *     variables: { branch: 'main' },
 *   });
 */

import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { childLogger } from '../core/logger.js';
import type { SkillManager } from './skill-manager.js';
import type { Skill } from './types.js';

const log = childLogger('skill-pipeline');
const execAsync = promisify(execCallback);

/** Default shell runner: executes via child_process and returns stdout. */
const defaultShellRunner = async (command: string): Promise<string> => {
  const { stdout } = await execAsync(command);
  return stdout;
};

// ─── Types ────────────────────────────────────────────────────────

export interface SkillInvokeOptions {
  /** Named arguments for $ARGUMENTS substitution. */
  arguments?: Record<string, unknown>;
  /** Variables for ${VARS} substitution. */
  variables?: Record<string, unknown>;
  /** Allow `!command` shell lines to execute. Default: false. */
  allowShell?: boolean;
  /** Shell runner override (for tests / sandboxes). */
  shellRunner?: (command: string) => Promise<string>;
}

export interface SkillInvokeResult {
  /** Whether the invocation succeeded. */
  ok: boolean;
  /** Rendered skill body (execution output). */
  output: string;
  /** Skill ID. */
  skillId: string;
  /** Skill name. */
  skillName: string;
  /** Skill version at invocation time. */
  version: string;
  /** Duration in ms. */
  durationMs: number;
  /** True when the skill declares `context: fork` (deferred to subagent). */
  fork: boolean;
  /** Shell commands that were executed. */
  executedCommands: string[];
  /** Non-fatal diagnostics. */
  warnings: string[];
  /** Error message (if failed). */
  error?: string;
}

export interface SkillMatch {
  /** Matched skill. */
  skill: Skill;
  /** Match strength (higher = better). */
  score: number;
  /** Trigger/keyword that matched. */
  matchedBy: string;
}

export interface SkillPipelineOptions {
  /** Default shell permission for invocations. Default: false. */
  allowShell?: boolean;
  /** Default shell runner override. */
  shellRunner?: (command: string) => Promise<string>;
}

// ─── SkillPipeline ────────────────────────────────────────────────

export class SkillPipeline {
  private readonly manager: SkillManager;
  private readonly defaultAllowShell: boolean;
  private readonly defaultShellRunner?: (command: string) => Promise<string>;

  constructor(manager: SkillManager, options?: SkillPipelineOptions) {
    this.manager = manager;
    this.defaultAllowShell = options?.allowShell ?? false;
    this.defaultShellRunner = options?.shellRunner;
  }

  /**
   * Trigger stage: match a message against skill triggers, name, and description.
   */
  match(message: string, filter?: { status?: string }): SkillMatch[] {
    const lower = message.toLowerCase();
    const matches: SkillMatch[] = [];

    for (const skill of this.manager.list()) {
      if (filter?.status && skill.status !== filter.status) continue;
      const score = this.scoreSkill(skill, lower);
      if (score > 0) {
        matches.push({
          skill,
          score,
          matchedBy: this.matchedBy(skill, lower),
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Execution stage: render and run a skill.
   */
  async invoke(id: string, options?: SkillInvokeOptions): Promise<SkillInvokeResult> {
    const startTime = Date.now();
    const skill = this.manager.get(id);
    if (!skill) {
      throw new Error(`[skill-pipeline] skill not found: ${id}`);
    }
    if (skill.status === 'archived' || skill.status === 'deprecated') {
      throw new Error(`[skill-pipeline] skill is not invocable (status: ${skill.status}): ${id}`);
    }

    const warnings: string[] = [];
    const allowShell = options?.allowShell ?? this.defaultAllowShell;
    const shellRunner = options?.shellRunner ?? this.defaultShellRunner;

    // Context stage
    const context = this.buildContext(skill, options);
    const fork = this.isFork(skill);

    // Execution stage — render body, then process shell lines
    let output = this.renderBody(skill.body, context);

    if (fork) {
      // Deferred to a subagent: no shell execution, produce a self-contained task
      const task = this.buildForkTask(skill, output, context);
      log.info({ id, version: skill.version }, 'skill forked to subagent');
      return {
        ok: true,
        output: task,
        skillId: skill.id,
        skillName: skill.name,
        version: skill.version,
        durationMs: Date.now() - startTime,
        fork: true,
        executedCommands: [],
        warnings,
      };
    }

    const { text, executed, shellWarnings } = await this.processShellLines(output, allowShell, shellRunner);
    output = text;
    warnings.push(...shellWarnings);

    log.info({ id, version: skill.version, fork }, 'skill invoked');
    return {
      ok: true,
      output,
      skillId: skill.id,
      skillName: skill.name,
      version: skill.version,
      durationMs: Date.now() - startTime,
      fork: false,
      executedCommands: executed,
      warnings,
    };
  }

  // ─── Internal ───────────────────────────────────────────────────

  private scoreSkill(skill: Skill, lowerMessage: string): number {
    let score = 0;

    const triggers = this.getTriggers(skill);
    for (const trigger of triggers) {
      if (lowerMessage.includes(trigger.toLowerCase())) {
        score += 10 + trigger.length;
      }
    }

    if (lowerMessage.includes(skill.name.toLowerCase())) score += 5;
    if (lowerMessage.includes(skill.description.toLowerCase())) score += 3;
    return score;
  }

  private matchedBy(skill: Skill, lowerMessage: string): string {
    for (const trigger of this.getTriggers(skill)) {
      if (lowerMessage.includes(trigger.toLowerCase())) return trigger;
    }
    if (lowerMessage.includes(skill.name.toLowerCase())) return skill.name;
    return skill.description;
  }

  private getTriggers(skill: Skill): string[] {
    const raw = skill.frontmatter?.triggers;
    if (Array.isArray(raw)) {
      return raw.filter((t): t is string => typeof t === 'string');
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
    return [];
  }

  private isFork(skill: Skill): boolean {
    return skill.frontmatter?.context === 'fork';
  }

  private buildContext(skill: Skill, options?: SkillInvokeOptions): Record<string, unknown> {
    return {
      arguments: options?.arguments ?? {},
      variables: options?.variables ?? {},
      skillId: skill.id,
      skillVersion: skill.version,
      skillName: skill.name,
    };
  }

  private renderBody(body: string, context: Record<string, unknown>): string {
    let text = body;

    // ${VARS} substitution
    const vars = context.variables as Record<string, unknown>;
    text = text.replace(/\$\{(\w+)\}/g, (_, key: string) =>
      vars[key] !== undefined ? String(vars[key]) : '',
    );

    // $ARGUMENTS.<name> substitution
    const args = context.arguments as Record<string, unknown>;
    text = text.replace(/\$ARGUMENTS\.(\w+)/g, (_, key: string) => {
      const value = args[key];
      return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    });

    // $ARGUMENTS (whole) substitution
    if (text.includes('$ARGUMENTS')) {
      const keys = Object.keys(args);
      const rendered = keys.length === 0
        ? ''
        : keys.length === 1
          ? String(args[keys[0]])
          : JSON.stringify(args, null, 2);
      text = text.split('$ARGUMENTS').join(rendered);
    }

    return text;
  }

  private async processShellLines(
    text: string,
    allowShell: boolean,
    shellRunner?: (command: string) => Promise<string>,
  ): Promise<{ text: string; executed: string[]; shellWarnings: string[] }> {
    const executed: string[] = [];
    const shellWarnings: string[] = [];
    const lines = text.split('\n');
    const out: string[] = [];

    for (const line of lines) {
      const match = line.match(/^[ \t]*!([^\n]*)$/);
      if (!match) {
        out.push(line);
        continue;
      }

      const command = match[1].trim();
      if (!allowShell) {
        shellWarnings.push(`shell disabled — command not executed: ${command}`);
        out.push(line);
        continue;
      }
      if (!command) {
        out.push(line);
        continue;
      }

      executed.push(command);
      try {
        const runner = shellRunner ?? defaultShellRunner;
        const output = await runner(command);
        out.push(output.trimEnd());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        shellWarnings.push(`shell command failed: ${command} — ${message}`);
        out.push(`<shell error: ${message}>`);
      }
    }

    return { text: out.join('\n'), executed, shellWarnings };
  }

  private buildForkTask(skill: Skill, rendered: string, context: Record<string, unknown>): string {
    const args = context.arguments as Record<string, unknown>;
    const parts: string[] = [];
    parts.push(`# ${skill.name}`);
    if (skill.description) parts.push(skill.description);
    parts.push(rendered);
    if (Object.keys(args).length > 0) {
      parts.push(`\n\n## Arguments\n\n${JSON.stringify(args, null, 2)}`);
    }
    return parts.join('\n\n');
  }
}
