/**
 * web-ui/lib/markdown.ts — Minimal markdown renderer for the knowledge
 * reader/editor preview (TR-02 security hardening, UI-24 part 2).
 *
 * Security contract:
 *  - ALL user text is HTML-escaped before it is placed in the output, so no
 *    raw HTML or attribute injection can survive.
 *  - Link hrefs are scheme-allowlisted (http/https/mailto + relative/anchor).
 *    `javascript:`, `data:`, `vbscript:` etc. are neutralised to `#`.
 *  - External links get rel="noopener noreferrer".
 *
 * The output is injected via dangerouslySetInnerHTML — keep every code path
 * here escape-first. Do NOT add transforms that reintroduce raw user input
 * into attributes.
 */

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

interface Heading extends TocEntry {
  raw: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Allowlist URL schemes for markdown links. Input arrives already
 * HTML-escaped, so `"`/`'` cannot break out of the attribute — the remaining
 * risk is an active-content scheme (javascript:, data:, vbscript:).
 * Control chars/whitespace are stripped before the scheme check so
 * `java\tscript:` / ` javascript:` bypasses fail closed.
 */
function sanitizeUrl(raw: string): string {
  const compact = raw.replace(/[\x00-\x20]+/g, '');
  // Anchors and relative paths are safe.
  if (compact.startsWith('#') || compact.startsWith('/')) return raw;
  // Explicit scheme — allowlist only.
  const schemeMatch = compact.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return raw;
    return '#';
  }
  // Scheme-relative //host/path is fine (inherits http/https).
  if (compact.startsWith('//')) return raw;
  // No scheme → relative link like `docs/page` — safe.
  return raw;
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Plain text of a heading, used for slugs and the table of contents. */
function headingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/** Slug that keeps Latin, digits and Cyrillic; never returns an empty id. */
export function slugifyHeading(text: string): string {
  const slug = headingText(text)
    .toLowerCase()
    .replace(/[^\w\u0400-\u04FF\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function collectHeadings(md: string): Heading[] {
  const used = new Map<string, number>();
  const headings: Heading[] = [];
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const raw = match[2].trim();
    const base = slugifyHeading(raw);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    headings.push({
      id: seen === 0 ? base : `${base}-${seen + 1}`,
      text: headingText(raw),
      level,
      raw,
    });
  }
  return headings;
}

/**
 * The reader shows the document title in its own header, so the leading h1
 * would otherwise appear twice. Remove only the first heading when it is the
 * first non-empty line; leave documents without one untouched.
 */
export function stripLeadingH1(md: string | null | undefined): string {
  if (typeof md !== 'string' || md.length === 0) return '';
  return md.replace(/^\s*#\s+[^\n]*(?:\n+|$)/, '');
}

/**
 * Build the "On this page" entries. The document title (h1) is deliberately
 * excluded; h2-h4 form the outline. Heading ids match `renderMarkdown`.
 */
export function buildToc(md: string | null | undefined): TocEntry[] {
  if (typeof md !== 'string' || md.length === 0) return [];
  return collectHeadings(md)
    .filter((heading) => heading.level >= 2 && heading.level <= 4)
    .map(({ id, text, level }) => ({ id, text, level }));
}

function renderInline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_match, text: string, href: string) => {
      const safe = sanitizeUrl(href);
      const external = isExternalUrl(safe);
      const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
      return `<a href="${safe}"${rel}>${text}</a>`;
    });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  if (/^\s*$/.test(line)) return true;
  if (/^#{1,4}\s+/.test(line)) return true;
  if (/^```/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) return true;
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return true;
  if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) return true;
  return false;
}

function renderList(lines: string[], ordered: boolean, start: number): { html: string; next: number } {
  const marker = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(marker);
    if (!match) break;
    items.push(`<li>${renderInline(escapeHtml(match[1]))}</li>`);
    index += 1;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: index };
}

/**
 * Render markdown to safe HTML. Supports headings h1-h4 (with stable,
 * de-duplicated ids), paragraphs, unordered/ordered lists, blockquotes,
 * fenced code blocks, tables, horizontal rules, inline code, emphasis and
 * allowlisted links.
 */
export function renderMarkdown(md: string | null | undefined): string {
  // The preview must never crash on a missing/partial document (F-01, UI-13).
  if (typeof md !== 'string' || md.length === 0) return '';

  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const headings = collectHeadings(md);
  let headingIndex = 0;
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const heading = headings[headingIndex];
      headingIndex += 1;
      if (heading) {
        html.push(`<h${heading.level} id="${heading.id}">${renderInline(escapeHtml(heading.raw))}</h${heading.level}>`);
      }
      index += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const head = header.map((cell) => `<th>${renderInline(escapeHtml(cell))}</th>`).join('');
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(escapeHtml(cell))}</td>`).join('')}</tr>`)
        .join('');
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote><p>${renderInline(escapeHtml(quote.join(' ')))}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const list = renderList(lines, ordered, index);
      html.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
  }

  return html.join('\n');
}
