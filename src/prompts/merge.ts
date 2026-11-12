/** Z-07: conservative 3-way prompt merge with validation (draft-first, human confirmation). */
export interface MergeInput { base: string; local: string; remote: string }
export interface MergeResult { status: 'clean' | 'conflict'; merged: string; conflicts: string[] }
export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!))].sort();
}
export function extractCommands(text: string): string[] {
  return [...new Set(text.split('\n').filter((l) => /^\s*!\S/.test(l)).map((l) => l.trim()))].sort();
}
export function mergePromptVersions({ base, local, remote }: MergeInput): MergeResult {
  const conflicts: string[] = [];
  let merged: string;
  if (local === remote) merged = local;
  else if (local === base) merged = remote;
  else if (remote === base) merged = local;
  else { merged = local; conflicts.push('both sides changed'); }
  const vars = new Set([...extractVariables(base), ...extractVariables(local), ...extractVariables(remote)]);
  for (const v of vars) if (!merged.includes(`{{${v}}}`) && !new RegExp(`\\{\\{\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`).test(merged)) conflicts.push(`missing variable: ${v}`);
  const known = new Set([...extractCommands(base), ...extractCommands(local), ...extractCommands(remote)]);
  const unknown = extractCommands(merged).filter((c) => !known.has(c));
  if (unknown.length) conflicts.push(`new command: ${unknown.join(', ')}`);
  const allowed = (t: string) => (t.match(/^allowed-tools:\s*(.+)$/m)?.[1] ?? '').trim();
  const knownTools = new Set([allowed(base), allowed(local)].filter(Boolean).flatMap((s) => s.split(',').map((x) => x.trim())));
  const mergedTools = allowed(merged).split(',').map((x) => x.trim()).filter(Boolean);
  const added = mergedTools.filter((t) => !knownTools.has(t));
  if (added.length) conflicts.push(`new allowed-tool: ${added.join(', ')}`);
  return { status: conflicts.length ? 'conflict' : 'clean', merged, conflicts };
}

