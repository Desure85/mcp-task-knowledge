/**
 * web-ui/lib/markdown.test.ts — TR-02 regression tests for the markdown
 * preview renderer. Every test is an XSS vector that must stay dead.
 */

import { describe, it, expect } from 'vitest';
import { buildToc, renderMarkdown, slugifyHeading, stripLeadingH1 } from './markdown';

describe('renderMarkdown — XSS hardening (TR-02)', () => {
  it('escapes double quotes → no attribute injection via link text', () => {
    const html = renderMarkdown('[x](" onclick="alert(1))');
    expect(html).not.toContain('onclick="alert');
    expect(html).toContain('&quot;');
  });

  it('neutralises javascript: URLs in links', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
  });

  it('neutralises javascript: with leading whitespace/control chars', () => {
    const html = renderMarkdown('[x](  javascript:alert(1))');
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it('neutralises JaVaScRiPt: mixed-case scheme', () => {
    const html = renderMarkdown('[x](JaVaScRiPt:alert(1))');
    expect(html).not.toMatch(/href="[^"]*javascript:/i);
  });

  it('neutralises data: and vbscript: URLs', () => {
    expect(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)')).toContain('href="#"');
    expect(renderMarkdown('[x](vbscript:msgbox(1))')).toContain('href="#"');
  });

  it('escapes raw HTML — script tags never reach output', () => {
    const html = renderMarkdown('"><script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes event-handler attributes in raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('allows http/https links and adds rel="noopener noreferrer"', () => {
    const html = renderMarkdown('[site](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('allows mailto: links', () => {
    const html = renderMarkdown('[mail](mailto:a@b.c)');
    expect(html).toContain('href="mailto:a@b.c"');
  });

  it('allows anchor and relative links', () => {
    expect(renderMarkdown('[a](#section)')).toContain('href="#section"');
    expect(renderMarkdown('[a](/docs/page)')).toContain('href="/docs/page"');
    expect(renderMarkdown('[a](docs/page)')).toContain('href="docs/page"');
  });

  it('keeps underscores in link hrefs intact', () => {
    expect(renderMarkdown('[a](https://example.com/a_b_c)')).toContain('href="https://example.com/a_b_c"');
  });

  it('still renders basic markdown (headings, bold, code, lists)', () => {
    const html = renderMarkdown('# Title\n\n**bold** and `code`\n\n- item');
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>item</li>');
  });

  it('renders h1-h4, blockquotes, fenced code, tables and rules', () => {
    const html = renderMarkdown([
      '# Title',
      '## Section',
      '### Detail',
      '#### Fine print',
      '',
      '> a quote',
      '',
      '```ts',
      'const value = "<script>";',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| one | **two** |',
      '',
      '---',
    ].join('\n'));

    expect(html).toContain('<h2 id="section">Section</h2>');
    expect(html).toContain('<h3 id="detail">Detail</h3>');
    expect(html).toContain('<h4 id="fine-print">Fine print</h4>');
    expect(html).toContain('<blockquote><p>a quote</p></blockquote>');
    expect(html).toContain('<pre><code>const value = &quot;&lt;script&gt;&quot;;</code></pre>');
    expect(html).toContain('<table><thead><tr><th>Name</th><th>Value</th></tr></thead>');
    expect(html).toContain('<td>one</td><td><strong>two</strong></td>');
    expect(html).toContain('<hr />');
  });

  it('keeps fenced code inert (no inline/link/emphasis rewriting)', () => {
    const html = renderMarkdown('```\n**not bold** [x](javascript:alert(1))\n```');
    expect(html).toContain('<pre><code>**not bold** [x](javascript:alert(1))</code></pre>');
    expect(html).not.toContain('<strong>');
  });

  it('escapes single quotes too (defence in depth for attribute contexts)', () => {
    const html = renderMarkdown("it's a test");
    expect(html).toContain('&#39;');
    expect(html).not.toContain("it's");
  });

  it('returns empty output for undefined/null instead of crashing (F-01, UI-13)', () => {
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});

describe('buildToc / heading ids', () => {
  it('builds an outline from h2-h4 with stable ids and excludes the title', () => {
    const toc = buildToc('# Title\n\n## First\n\n### Detail\n\n#### Fine\n');
    expect(toc).toEqual([
      { id: 'first', text: 'First', level: 2 },
      { id: 'detail', text: 'Detail', level: 3 },
      { id: 'fine', text: 'Fine', level: 4 },
    ]);
  });

  it('de-duplicates repeated headings and matches renderMarkdown', () => {
    const md = '## Same\n\n## Same\n\n## Same';
    expect(buildToc(md).map((entry) => entry.id)).toEqual(['same', 'same-2', 'same-3']);
    const html = renderMarkdown(md);
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
    expect(html).toContain('id="same-3"');
  });

  it('keeps Cyrillic heading slugs readable', () => {
    const toc = buildToc('## Привет, мир!');
    expect(toc).toEqual([{ id: 'привет-мир', text: 'Привет, мир!', level: 2 }]);
    expect(renderMarkdown('## Привет, мир!')).toContain('id="привет-мир"');
  });

  it('returns no entries for empty or missing content', () => {
    expect(buildToc(undefined)).toEqual([]);
    expect(buildToc(null)).toEqual([]);
    expect(buildToc('')).toEqual([]);
    expect(buildToc('plain paragraph only')).toEqual([]);
  });

  it('never returns an empty slug', () => {
    expect(slugifyHeading('!!!')).toBe('section');
    expect(buildToc('## !!!')).toEqual([{ id: 'section', text: '!!!', level: 2 }]);
  });
});

describe('stripLeadingH1', () => {
  it('removes the leading title heading used by the reader header', () => {
    expect(stripLeadingH1('# Title\n\n## Section\n\nBody')).toBe('## Section\n\nBody');
    expect(stripLeadingH1('\n\n# Title\nBody')).toBe('Body');
  });

  it('leaves documents without a leading h1 intact', () => {
    expect(stripLeadingH1('## Section\n\nBody')).toBe('## Section\n\nBody');
    expect(stripLeadingH1('Body\n\n# Later')).toBe('Body\n\n# Later');
    expect(stripLeadingH1(undefined)).toBe('');
  });
});
