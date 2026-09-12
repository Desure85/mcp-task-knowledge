/**
 * web-ui/lib/markdown.ts — Minimal markdown renderer for the knowledge
 * preview pane (TR-02 security hardening).
 *
 * Security contract:
 *  - ALL input is HTML-escaped first (`& < > " '`), so no raw HTML or
 *    attribute injection can survive into the output.
 *  - Link hrefs are scheme-allowlisted (http/https/mailto + relative/anchor).
 *    `javascript:`, `data:`, `vbscript:` etc. are neutralised to `#`.
 *  - External links get rel="noopener noreferrer".
 *
 * The output is still injected via dangerouslySetInnerHTML — keep every
 * code path here escape-first. Do NOT add transforms that reintroduce
 * raw user input into attributes.
 */

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

export function renderMarkdown(md: string): string {
  return escapeHtml(md)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\[(.+?)\]\((.+?)\)/g, (_m, text: string, href: string) => {
      const safe = sanitizeUrl(href);
      const external = isExternalUrl(safe);
      const rel = external ? ' rel="noopener noreferrer" target="_blank"' : '';
      return `<a href="${safe}" class="text-blue-600 underline"${rel}>${text}</a>`;
    })
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}
