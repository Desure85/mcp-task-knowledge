/**
 * T-02 — project-level access control.
 *
 * Membership lives in `DATA_DIR/projects/<id>.json` (`members`), the same file
 * that already carries statuses/types/closeStatus. Reads are synchronous because
 * the security gate runs in the tool dispatch path; the file is small.
 *
 * Compatibility: a project with no `members` map is treated as legacy/public.
 * Once an admin adds at least one member, only members (and global `admin`
 * roles) can access it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getCurrentProject } from '../config.js';
import { resolveUnder } from '../fs.js';
import type { ProjectMetadata, ProjectMembers, ProjectRole } from '../projects.js';

export type { ProjectRole, ProjectMembers };

export const PROJECT_ROLES: readonly ProjectRole[] = ['viewer', 'editor', 'admin'];

const WRITE_TOOL_RE =
  /(?:^|_)(?:create|update|delete|archive|trash|restore|close|claim|renew|release|bulk|import|write|set|remove|add|move|detach|promote|demote|flush)(?:_|$)/;

/** Tools that need an explicit project-admin project role. */
const PROJECT_ADMIN_TOOL_RE = /^project_(?:update|delete|members_|statuses_set|types_set|transitions_set|agents_set)/;

/** Project-scoped tool families; other tools (project_list, admin_*, mcp_*) are exempt. */
const PROJECT_SCOPED_RE = /^(?:tasks|knowledge|prompts|search|graph|dashboard|project)_/;

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_RE.test(toolName);
}

export function isProjectAdminTool(toolName: string): boolean {
  return PROJECT_ADMIN_TOOL_RE.test(toolName);
}

export function projectScoped(toolName: string): boolean {
  return PROJECT_SCOPED_RE.test(toolName) && toolName !== 'project_list' && toolName !== 'project_create';
}

export function projectFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const value = record.project ?? record.projectId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readProjectMembersSync(project: string): ProjectMembers | undefined {
  try {
    const file = resolveUnder(path.join(DATA_DIR, 'projects'), `${project}.json`);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectMetadata;
    return raw.members && typeof raw.members === 'object' ? raw.members : undefined;
  } catch {
    return undefined;
  }
}

export interface ProjectAccessContext {
  project: string;
  userId?: string;
  globalRoles: string[];
  open: boolean;
}

export type ProjectAccess =
  | { allowed: true; role: ProjectRole | 'legacy'; reason: 'open' | 'global-admin' | 'member' | 'legacy' }
  | { allowed: false; reason: string };

/** Resolve a project role without throwing for unknown/foreign projects. */
export function resolveAccess(ctx: ProjectAccessContext): ProjectAccess {
  if (ctx.open) return { allowed: true, role: 'admin', reason: 'open' };
  if (ctx.globalRoles.includes('admin')) return { allowed: true, role: 'admin', reason: 'global-admin' };
  const members = readProjectMembersSync(ctx.project);
  if (!members || Object.keys(members).length === 0) {
    return { allowed: true, role: 'legacy', reason: 'legacy' };
  }
  const role = ctx.userId ? members[ctx.userId] : undefined;
  if (!role || !PROJECT_ROLES.includes(role)) {
    return { allowed: false, reason: `no membership in project ${ctx.project}` };
  }
  return { allowed: true, role, reason: 'member' };
}

export function projectRoleFor(ctx: ProjectAccessContext): ProjectRole | 'legacy' | null {
  const access = resolveAccess(ctx);
  return access.allowed ? access.role : null;
}

/** Gate a tool call. Returns a deny reason or null. */
export function checkProjectToolCall(options: {
  toolName: string;
  input: unknown;
  userId?: string;
  globalRoles: string[];
  open: boolean;
  currentProject?: string;
}): { allowed: true } | { allowed: false; reason: string } {
  if (!projectScoped(options.toolName)) return { allowed: true };
  const project = projectFromInput(options.input) ?? options.currentProject ?? getCurrentProject();
  const access = resolveAccess({
    project,
    userId: options.userId,
    globalRoles: options.globalRoles,
    open: options.open,
  });
  if (!access.allowed) return { allowed: false, reason: access.reason };
  if (access.role === 'viewer' && isWriteTool(options.toolName)) {
    return { allowed: false, reason: `role viewer cannot call ${options.toolName} in project ${project}` };
  }
  if (isProjectAdminTool(options.toolName) && access.role !== 'admin') {
    return { allowed: false, reason: `project ${project} requires admin role` };
  }
  return { allowed: true };
}

/** Filter project ids visible to the caller (project_list). */
export function filterVisibleProjects<T extends { id: string }>(projects: T[], ctx: Omit<ProjectAccessContext, 'project'>): T[] {
  return projects.filter((project) =>
    resolveAccess({ ...ctx, project: project.id }).allowed,
  );
}
