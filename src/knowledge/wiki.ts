/** T-05: wiki links, backlinks and draft→published status. */
export interface WikiDocRef { id: string; title: string; content: string }
export function slugifyWikiTarget(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}
export function parseWikiLinks(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const target = m[1]!.trim();
    if (target) out.push(target);
  }
  return [...new Set(out)];
}
export function resolveWikiTarget(target: string, docs: WikiDocRef[]): WikiDocRef | undefined {
  const slug = slugifyWikiTarget(target);
  return docs.find((d) => d.id === target || d.title === target || slugifyWikiTarget(d.title) === slug);
}
export function buildBacklinks(docs: WikiDocRef[]): Map<string, Array<{ id: string; title: string; target: string }>> {
  const map = new Map<string, Array<{ id: string; title: string; target: string }>>();
  for (const source of docs) {
    for (const target of parseWikiLinks(source.content)) {
      const doc = resolveWikiTarget(target, docs);
      if (!doc || doc.id === source.id) continue;
      const list = map.get(doc.id) ?? [];
      list.push({ id: source.id, title: source.title, target });
      map.set(doc.id, list);
    }
  }
  return map;
}
