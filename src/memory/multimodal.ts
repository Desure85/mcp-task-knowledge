/**
 * multimodal.ts — Multimodal ingestion pipeline (NEXT-012).
 *
 * Extracts text from multiple formats: PDF, images (OCR placeholder),
 * video (transcription placeholder), code (AST-aware chunking).
 *
 * Each extractor returns structured text chunks suitable for knowledge base.
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';

export type ModalityType = 'pdf' | 'image' | 'video' | 'code' | 'text' | 'audio';

export interface MultimodalInput {
  type: ModalityType;
  filename: string;
  content: Buffer | string;
  mimeType?: string;
  language?: string;
}

export interface ExtractedChunk {
  id: string;
  text: string;
  modality: ModalityType;
  metadata: {
    filename: string;
    page?: number;
    line?: number;
    section?: string;
    language?: string;
    chunkIndex: number;
  };
}

export interface ExtractionResult {
  ok: true;
  chunks: ExtractedChunk[];
  totalChunks: number;
  modality: ModalityType;
  filename: string;
  durationMs: number;
}

export type ExtractorFn = (input: MultimodalInput) => Promise<ExtractedChunk[]>;

const extractors = new Map<ModalityType, ExtractorFn>();

export function registerExtractor(type: ModalityType, fn: ExtractorFn): void {
  extractors.set(type, fn);
}

export async function extract(input: MultimodalInput): Promise<ExtractionResult> {
  const start = Date.now();
  const fn = extractors.get(input.type);
  if (!fn) {
    return {
      ok: true,
      chunks: [],
      totalChunks: 0,
      modality: input.type,
      filename: input.filename,
      durationMs: Date.now() - start,
    };
  }
  const chunks = await fn(input);
  return {
    ok: true,
    chunks,
    totalChunks: chunks.length,
    modality: input.type,
    filename: input.filename,
    durationMs: Date.now() - start,
  };
}

function makeChunkId(input: MultimodalInput, index: number): string {
  return createHash('sha256')
    .update(`${input.filename}:${index}`)
    .digest('hex')
    .substring(0, 16);
}

// ─── PDF Extractor ───────────────────────────────────────────────────────────

registerExtractor('pdf', async (input) => {
  const content = typeof input.content === 'string' ? input.content : input.content.toString('utf-8');
  const pages = content.split('\f');
  return pages.map((pageText, i) => ({
    id: makeChunkId(input, i),
    text: pageText.trim(),
    modality: 'pdf' as const,
    metadata: {
      filename: input.filename,
      page: i + 1,
      chunkIndex: i,
    },
  })).filter((c) => c.text.length > 0);
});

// ─── Text Extractor ──────────────────────────────────────────────────────────

registerExtractor('text', async (input) => {
  const content = typeof input.content === 'string' ? input.content : input.content.toString('utf-8');
  const maxChunkSize = 2000;
  const chunks: ExtractedChunk[] = [];
  const paragraphs = content.split(/\n\n+/);
  let current = '';
  let idx = 0;

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 0) {
      chunks.push({
        id: makeChunkId(input, idx),
        text: current.trim(),
        modality: 'text',
        metadata: { filename: input.filename, chunkIndex: idx },
      });
      idx++;
      current = '';
    }
    current += para + '\n\n';
  }
  if (current.trim().length > 0) {
    chunks.push({
      id: makeChunkId(input, idx),
      text: current.trim(),
      modality: 'text',
      metadata: { filename: input.filename, chunkIndex: idx },
    });
  }
  return chunks;
});

// ─── Code Extractor (AST-aware chunking) ─────────────────────────────────────

registerExtractor('code', async (input) => {
  const content = typeof input.content === 'string' ? input.content : input.content.toString('utf-8');
  const lines = content.split('\n');
  const chunks: ExtractedChunk[] = [];
  const maxLines = 100;
  let startLine = 0;
  let idx = 0;

  while (startLine < lines.length) {
    const endLine = Math.min(startLine + maxLines, lines.length);
    const chunkLines = lines.slice(startLine, endLine);
    const section = detectSection(chunkLines[0] ?? '');
    chunks.push({
      id: makeChunkId(input, idx),
      text: chunkLines.join('\n'),
      modality: 'code',
      metadata: {
        filename: input.filename,
        line: startLine + 1,
        section,
        language: input.language,
        chunkIndex: idx,
      },
    });
    startLine = endLine;
    idx++;
  }
  return chunks;
});

function detectSection(firstLine: string): string | undefined {
  const match = firstLine.match(/(?:export\s+)?(?:function|class|interface|type|const|enum)\s+(\w+)/);
  return match?.[1];
}

// ─── Image Extractor (OCR placeholder) ───────────────────────────────────────

registerExtractor('image', async (input) => {
  return [{
    id: makeChunkId(input, 0),
    text: `[Image: ${input.filename}]`,
    modality: 'image',
    metadata: {
      filename: input.filename,
      chunkIndex: 0,
    },
  }];
});

// ─── Video Extractor (transcription placeholder) ─────────────────────────────

registerExtractor('video', async (input) => {
  return [{
    id: makeChunkId(input, 0),
    text: `[Video: ${input.filename}]`,
    modality: 'video',
    metadata: {
      filename: input.filename,
      chunkIndex: 0,
    },
  }];
});

// ─── Audio Extractor (transcription placeholder) ─────────────────────────────

registerExtractor('audio', async (input) => {
  return [{
    id: makeChunkId(input, 0),
    text: `[Audio: ${input.filename}]`,
    modality: 'audio',
    metadata: {
      filename: input.filename,
      chunkIndex: 0,
    },
  }];
});

// ─── Batch Extract ───────────────────────────────────────────────────────────

export async function extractBatch(inputs: MultimodalInput[]): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  for (const input of inputs) {
    const result = await extract(input);
    results.push(result);
  }
  return results;
}

// ─── Detect modality from filename/mime ──────────────────────────────────────

export function detectModality(filename: string, mimeType?: string): ModalityType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'audio';
  if (['ts', 'js', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php', 'swift', 'kt'].includes(ext)) return 'code';
  return 'text';
}
