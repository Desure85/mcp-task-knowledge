/**
 * multimodal.spec.ts — Tests for multimodal ingestion (NEXT-012).
 */

import { describe, it, expect } from 'vitest';
import {
  extract,
  extractBatch,
  detectModality,
  registerExtractor,
  type MultimodalInput,
  type ExtractedChunk,
} from '../src/memory/multimodal.js';

describe('detectModality', () => {
  it('detects PDF from extension', () => {
    expect(detectModality('doc.pdf')).toBe('pdf');
  });

  it('detects PDF from mime', () => {
    expect(detectModality('file', 'application/pdf')).toBe('pdf');
  });

  it('detects image formats', () => {
    expect(detectModality('photo.png')).toBe('image');
    expect(detectModality('photo.jpg')).toBe('image');
    expect(detectModality('photo.jpeg')).toBe('image');
    expect(detectModality('photo.gif')).toBe('image');
    expect(detectModality('photo.webp')).toBe('image');
  });

  it('detects video formats', () => {
    expect(detectModality('clip.mp4')).toBe('video');
    expect(detectModality('clip.avi')).toBe('video');
    expect(detectModality('clip.mov')).toBe('video');
  });

  it('detects audio formats', () => {
    expect(detectModality('song.mp3')).toBe('audio');
    expect(detectModality('song.wav')).toBe('audio');
    expect(detectModality('song.ogg')).toBe('audio');
  });

  it('detects code formats', () => {
    expect(detectModality('app.ts')).toBe('code');
    expect(detectModality('app.js')).toBe('code');
    expect(detectModality('app.py')).toBe('code');
    expect(detectModality('app.go')).toBe('code');
    expect(detectModality('app.rs')).toBe('code');
    expect(detectModality('app.php')).toBe('code');
  });

  it('defaults to text', () => {
    expect(detectModality('readme.md')).toBe('text');
    expect(detectModality('notes.txt')).toBe('text');
    expect(detectModality('data.json')).toBe('text');
  });
});

describe('extract — text', () => {
  it('extracts text into paragraph-based chunks', async () => {
    const input: MultimodalInput = {
      type: 'text',
      filename: 'test.txt',
      content: 'Paragraph one.\n\nParagraph two.\n\nParagraph three.',
    };
    const result = await extract(input);
    expect(result.ok).toBe(true);
    expect(result.modality).toBe('text');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.totalChunks).toBe(result.chunks.length);
  });

  it('splits long text into multiple chunks', async () => {
    const longPara = 'A'.repeat(1500);
    const input: MultimodalInput = {
      type: 'text',
      filename: 'long.txt',
      content: `${longPara}\n\n${longPara}\n\n${longPara}`,
    };
    const result = await extract(input);
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('handles empty content', async () => {
    const input: MultimodalInput = {
      type: 'text',
      filename: 'empty.txt',
      content: '',
    };
    const result = await extract(input);
    expect(result.chunks).toHaveLength(0);
  });

  it('sets correct metadata', async () => {
    const input: MultimodalInput = {
      type: 'text',
      filename: 'meta.txt',
      content: 'Some content here.',
    };
    const result = await extract(input);
    expect(result.chunks[0].metadata.filename).toBe('meta.txt');
    expect(result.chunks[0].metadata.chunkIndex).toBe(0);
  });
});

describe('extract — code', () => {
  it('chunks code by line count', async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `const x${i} = ${i};`);
    const input: MultimodalInput = {
      type: 'code',
      filename: 'app.ts',
      content: lines.join('\n'),
      language: 'typescript',
    };
    const result = await extract(input);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks[0].metadata.language).toBe('typescript');
    expect(result.chunks[0].metadata.line).toBe(1);
  });

  it('detects section from first line', async () => {
    const input: MultimodalInput = {
      type: 'code',
      filename: 'svc.ts',
      content: 'export function myFunc() {\n  return 42;\n}',
      language: 'typescript',
    };
    const result = await extract(input);
    expect(result.chunks[0].metadata.section).toBe('myFunc');
  });

  it('handles short code files', async () => {
    const input: MultimodalInput = {
      type: 'code',
      filename: 'tiny.py',
      content: 'print("hello")',
      language: 'python',
    };
    const result = await extract(input);
    expect(result.chunks).toHaveLength(1);
  });
});

describe('extract — pdf', () => {
  it('splits PDF by form feed', async () => {
    const input: MultimodalInput = {
      type: 'pdf',
      filename: 'doc.pdf',
      content: 'Page 1 content\fPage 2 content\fPage 3 content',
    };
    const result = await extract(input);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0].metadata.page).toBe(1);
    expect(result.chunks[1].metadata.page).toBe(2);
    expect(result.chunks[2].metadata.page).toBe(3);
  });

  it('handles single page PDF', async () => {
    const input: MultimodalInput = {
      type: 'pdf',
      filename: 'single.pdf',
      content: 'Single page content',
    };
    const result = await extract(input);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].metadata.page).toBe(1);
  });

  it('filters empty pages', async () => {
    const input: MultimodalInput = {
      type: 'pdf',
      filename: 'gaps.pdf',
      content: 'Content\f\f\fMore content',
    };
    const result = await extract(input);
    expect(result.chunks.length).toBe(2);
  });
});

describe('extract — image/video/audio', () => {
  it('image returns placeholder chunk', async () => {
    const result = await extract({ type: 'image', filename: 'photo.png', content: Buffer.from('') });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('[Image:');
  });

  it('video returns placeholder chunk', async () => {
    const result = await extract({ type: 'video', filename: 'clip.mp4', content: Buffer.from('') });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('[Video:');
  });

  it('audio returns placeholder chunk', async () => {
    const result = await extract({ type: 'audio', filename: 'song.mp3', content: Buffer.from('') });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain('[Audio:');
  });
});

describe('extract — unregistered type', () => {
  it('returns empty chunks for unknown type', async () => {
    registerExtractor('text', async () => []);
    const result = await extract({ type: 'text', filename: 'empty.txt', content: '' });
    expect(result.ok).toBe(true);
    expect(result.chunks).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('extractBatch', () => {
  it('processes multiple inputs', async () => {
    const inputs: MultimodalInput[] = [
      { type: 'text', filename: 'a.txt', content: 'Content A' },
      { type: 'text', filename: 'b.txt', content: 'Content B' },
      { type: 'code', filename: 'c.ts', content: 'const x = 1;', language: 'typescript' },
    ];
    const results = await extractBatch(inputs);
    expect(results).toHaveLength(3);
    expect(results[0].filename).toBe('a.txt');
    expect(results[1].filename).toBe('b.txt');
    expect(results[2].filename).toBe('c.ts');
  });

  it('handles empty batch', async () => {
    const results = await extractBatch([]);
    expect(results).toHaveLength(0);
  });
});

describe('ExtractionResult', () => {
  it('includes durationMs', async () => {
    const result = await extract({ type: 'text', filename: 't.txt', content: 'test' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes modality', async () => {
    const result = await extract({ type: 'code', filename: 't.ts', content: 'const x=1;', language: 'ts' });
    expect(result.modality).toBe('code');
  });
});
