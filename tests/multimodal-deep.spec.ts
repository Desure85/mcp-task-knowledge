/**
 * multimodal-deep.spec.ts — Deep-path tests for NEXT-012 zero-dep upgrades.
 *
 * All fixtures are built inline (no network, no binaries on disk):
 * minimal %PDF buffers (Flate via node:zlib), hand-crafted PNG/JPEG bytes,
 * inline SVG/SRT/WebVTT text, synthetic source files.
 */

import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { extract } from '../src/memory/multimodal.js';

function buildPdf(streamPayloads: Buffer[], compressed: boolean): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  streamPayloads.forEach((payload, i) => {
    const data = compressed ? deflateSync(payload) : payload;
    parts.push(
      Buffer.from(
        `${i + 1} 0 obj\n<< /Length ${data.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
        'latin1',
      ),
    );
    parts.push(data);
    parts.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
  });
  parts.push(Buffer.from('trailer\n%%EOF', 'latin1'));
  return Buffer.concat(parts);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); // parser ignores CRC — hermetic fixture
  return Buffer.concat([header, data, crc]);
}

function buildPngWithText(keyword: string, text: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  const textData = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'latin1'),
  ]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', textData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildJpegWithComment(comment: string): Buffer {
  const body = Buffer.from(comment, 'latin1');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xfe]),
    len,
    body,
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe('extract — pdf with real %PDF bytes', () => {
  it('extracts text from a FlateDecode stream', async () => {
    const pdf = buildPdf([Buffer.from('BT /F1 12 Tf 72 712 Td (Hello PDF world) Tj ET', 'latin1')], true);
    const result = await extract({ type: 'pdf', filename: 'doc.pdf', content: pdf });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('Hello PDF world');
    expect(result.chunks[0].metadata.page).toBe(1);
  });

  it('extracts text from an uncompressed stream', async () => {
    const pdf = buildPdf([Buffer.from('BT (Raw stream text) Tj ET', 'latin1')], false);
    const result = await extract({ type: 'pdf', filename: 'raw.pdf', content: pdf });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('Raw stream text');
  });

  it('one chunk per content stream (page-ish)', async () => {
    const pdf = buildPdf(
      [
        Buffer.from('BT (First page) Tj ET', 'latin1'),
        Buffer.from('BT (Second page) Tj ET', 'latin1'),
      ],
      true,
    );
    const result = await extract({ type: 'pdf', filename: 'two.pdf', content: pdf });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].metadata.page).toBe(1);
    expect(result.chunks[1].metadata.page).toBe(2);
  });

  it('decodes hex string operands', async () => {
    const pdf = buildPdf([Buffer.from('BT <48656C6C6F> Tj ET', 'latin1')], false);
    const result = await extract({ type: 'pdf', filename: 'hex.pdf', content: pdf });
    expect(result.chunks[0].text).toContain('Hello');
  });

  it('binary-only PDF yields an honest placeholder, not garbage', async () => {
    const pdf = buildPdf([Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x90])], false);
    const result = await extract({ type: 'pdf', filename: 'scan.pdf', content: pdf });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('no extractable text');
  });

  it('non-PDF buffer labelled pdf keeps the form-feed fallback', async () => {
    const result = await extract({ type: 'pdf', filename: 'note.pdf', content: 'A\fB' });
    expect(result.chunks).toHaveLength(2);
  });
});

describe('extract — image embedded text', () => {
  it('reads PNG tEXt keywords', async () => {
    const png = buildPngWithText('Title', 'Test Image');
    const result = await extract({ type: 'image', filename: 'pic.png', content: png });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe('Title: Test Image');
    expect(result.chunks[0].metadata.section).toBe('Title');
  });

  it('reads JPEG COM segments', async () => {
    const jpg = buildJpegWithComment('A comment here');
    const result = await extract({ type: 'image', filename: 'pic.jpg', content: jpg });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe('A comment here');
    expect(result.chunks[0].metadata.section).toBe('comment');
  });

  it('reads SVG text/title elements', async () => {
    const svg = '<svg><title>My Diagram</title><text>Hello SVG</text></svg>';
    const result = await extract({ type: 'image', filename: 'pic.svg', content: svg });
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.chunks.map((c) => c.text)).toContain('My Diagram');
    expect(result.chunks.map((c) => c.text)).toContain('Hello SVG');
  });

  it('imagery without embedded text yields an honest placeholder', async () => {
    const png = buildPngWithText('', '');
    const result = await extract({ type: 'image', filename: 'bare.png', content: png });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('[Image:');
    expect(result.chunks[0].text).toContain('OCR engine not bundled');
  });
});

describe('extract — video/audio transcripts', () => {
  const SRT = '1\n00:00:01,000 --> 00:00:04,000\nHello there.\n\n2\n00:00:05,000 --> 00:00:07,000\nGeneral Kenobi.\n';

  it('parses SRT cues into a timestamped chunk', async () => {
    const result = await extract({ type: 'video', filename: 'clip.srt', content: SRT });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('Hello there.');
    expect(result.chunks[0].text).toContain('General Kenobi.');
    expect(result.chunks[0].text).toContain('00:00:01,000 --> 00:00:04,000');
    expect(result.chunks[0].metadata.section).toContain('-->');
  });

  it('parses WebVTT for audio', async () => {
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nSpoken words here.\n';
    const result = await extract({ type: 'audio', filename: 'talk.vtt', content: vtt });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('Spoken words here.');
  });

  it('binary media without transcript yields an honest placeholder', async () => {
    const result = await extract({
      type: 'video',
      filename: 'clip.mp4',
      content: Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]),
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('[Video:');
    expect(result.chunks[0].text).toContain('speech-to-text engine not bundled');
  });
});

describe('extract — code boundary-aware chunking', () => {
  function fnBlock(name: string, bodyLines: number): string[] {
    const lines = [`export function ${name}() {`];
    for (let i = 0; i < bodyLines; i++) lines.push(`  const v${i} = ${i};`);
    lines.push('}');
    return lines;
  }

  it('never splits a symbol across chunks', async () => {
    const lines = ['// header', "import { x } from './x';", ...fnBlock('a', 38), ...fnBlock('b', 38), ...fnBlock('c', 38)];
    const result = await extract({ type: 'code', filename: 'svc.ts', content: lines.join('\n'), language: 'typescript' });
    expect(result.chunks.length).toBeGreaterThan(1);
    // every chunk after the first must start at a symbol definition line
    for (const chunk of result.chunks.slice(1)) {
      const startLine = lines[chunk.metadata.line! - 1];
      expect(startLine).toMatch(/export function \w+\(\) \{/);
    }
    expect(result.chunks[result.chunks.length - 1].metadata.section).toBe('c');
  });

  it('hard-splits a single oversized symbol, keeping its section', async () => {
    const lines = fnBlock('huge', 250);
    const result = await extract({ type: 'code', filename: 'big.ts', content: lines.join('\n'), language: 'typescript' });
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      expect(chunk.metadata.section).toBe('huge');
    }
  });

  it('detects python def symbols', async () => {
    const py = 'import os\n\ndef alpha():\n    return 1\n\ndef beta():\n    return 2\n';
    const result = await extract({ type: 'code', filename: 'mod.py', content: py, language: 'python' });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].metadata.section).toBe('alpha');
  });

  it('empty code yields no chunks', async () => {
    const result = await extract({ type: 'code', filename: 'empty.ts', content: '   \n  ' });
    expect(result.chunks).toHaveLength(0);
  });
});
