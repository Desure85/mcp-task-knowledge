/**
 * web-ui/lib/markdown.test.ts — TR-02 regression tests for the markdown
 * preview renderer. Every test is an XSS vector that must stay dead.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

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

  it('still renders basic markdown (headings, bold, code, lists)', () => {
    const html = renderMarkdown('# Title\n\n**bold** and `code`\n\n- item');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>item</li>');
  });

  it('escapes single quotes too (defence in depth for attribute contexts)', () => {
    const html = renderMarkdown("it's a test");
    expect(html).toContain('&#39;');
    expect(html).not.toContain("it's");
  });
});
