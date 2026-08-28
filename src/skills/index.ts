/**
 * skills/index.ts — Skills module exports.
 */

export { SkillManager } from './skill-manager.js';
export type { Skill, CreateSkillInput, UpdateSkillInput, SkillVersion, SkillStatus } from './types.js';

export { SkillPipeline } from './skill-pipeline.js';
export type { SkillInvokeOptions, SkillInvokeResult, SkillMatch, SkillPipelineOptions } from './skill-pipeline.js';

export { SkillDiscovery } from './skill-discovery.js';
export type { CategoryCount, SearchFilter, ImportOptions, ImportResult } from './skill-discovery.js';

export { skillTemplates, listSkillTemplates, getSkillTemplate, buildSkillFromTemplate, installSkillFromTemplate } from './skill-templates.js';
export type { SkillTemplate } from './skill-templates.js';

export { toCursorRules, toSkillMd, toClinerules, toMarkdown, convertSkill, fileNameFor, exportSkills } from './skill-converters.js';
export type { SkillExportFormat, ExportResult } from './skill-converters.js';

export { SkillPermissions } from './skill-permissions.js';
export type { SkillScope, InvocationCaller, InvocationContext, PermissionDecision, PermissionResult } from './skill-permissions.js';
