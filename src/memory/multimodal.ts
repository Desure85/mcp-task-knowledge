/**
 * multimodal.ts — Multimodal ingestion pipeline (NEXT-012).
 *
 * Zero-dependency text extraction per modality (Node builtins only):
 * - pdf: minimal content-stream text extraction (%PDF header check, FlateDecode
 *   via node:zlib, literal/hex text-showing operands); plain-text buffers
 *   labelled pdf fall back to form-feed page split.
 * - image: embedded text metadata (PNG tEXt/iTXt, JPEG COM, SVG text/title/desc).
 *   Full OCR engines are NOT bundled — plug one via registerExtractor().
 * - video/audio: SRT/WebVTT transcript cue parsing with timestamps; binary media
 *   without a transcript yields an honest size placeholder. Transcription engines
 *   are NOT bundled — plug one via registerExtractor().
 * - code: boundary-aware chunking — top-level symbols (function/class/def/fn/…)
 *   are never split across chunks unless one symbol exceeds maxLines.
 *
 * Each extractor returns structured text chunks suitable for knowledge base.
 */

/// <reference types="node" />
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

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

function bufferOf(content: Buffer | string): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf-8') : Buffer.from(content);
}

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
}

/** Locate raw `stream … endstream` payloads. Indices align: latin1 is 1 byte/char. */
function findContentStreams(buf: Buffer): Buffer[] {
  const streams: Buffer[] = [];
  const raw = buf.toString('latin1');
  let from = 0;
  while (true) {
    const s = raw.indexOf('stream', from);
    if (s === -1) break;
    // Skip the 'stream' inside 'endstream' itself.
    if (s >= 3 && raw.substring(s - 3, s) === 'end') {
      from = s + 6;
      continue;
    }
    let dataStart = s + 6;
    if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2;
    else if (raw[dataStart] === '\n' || raw[dataStart] === '\r') dataStart += 1;
    else {
      from = s + 6;
      continue;
    }
    const e = raw.indexOf('endstream', dataStart);
    if (e === -1) break;
    streams.push(buf.subarray(dataStart, e));
    from = e + 9;
  }
  return streams;
}

function inflateIfNeeded(chunk: Buffer): Buffer {
  try {
    return inflateSync(chunk);
  } catch {
    return chunk;
  }
}

/** Heuristic: skip binary streams (embedded images/fonts) that inflate to garbage. */
function isMostlyText(data: Buffer): boolean {
  if (data.length === 0) return false;
  const sample = data.subarray(0, Math.min(data.length, 4096));
  let bad = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) continue;
    bad++;
  }
  return bad / sample.length < 0.3;
}

function unescapePdfLiteral(inner: string): string {
  return inner.replace(
    /\\(n|r|t|b|f|\\|\(|\)|\r\n|\r|\n)|\\([0-7]{1,3})/g,
    (_match: string, simple?: string, octal?: string) => {
      if (octal !== undefined) return String.fromCharCode(parseInt(octal, 8));
      switch (simple) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'b': return '\b';
        case 'f': return '\f';
        case '\\': return '\\';
        case '(': return '(';
        case ')': return ')';
        default: return ''; // escaped EOL = line continuation, dropped
      }
    },
  );
}

/** Collect literal `(…)` and hex `<…>` strings from a content stream. */
function extractPdfStrings(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') {
      let depth = 0;
      let inner = '';
      let j = i;
      let closed = false;
      while (j < s.length) {
        const c = s[j];
        if (c === '\\' && j + 1 < s.length) {
          inner += s.substring(j, j + 2);
          j += 2;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) {
            closed = true;
            break;
          }
        }
        inner += c;
        j++;
      }
      if (closed) {
        const text = unescapePdfLiteral(inner).trim();
        if (text.length > 0) out.push(text);
        i = j + 1;
      } else {
        i++;
      }
    } else if (ch === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i + 1);
      if (end !== -1) {
        const hex = s.substring(i + 1, end).replace(/\s+/g, '');
        if (/^[0-9a-fA-F]+$/.test(hex) && hex.length > 0) {
          const padded = hex.length % 2 === 1 ? hex + '0' : hex;
          const text = Buffer.from(padded, 'hex').toString('latin1').trim();
          if (text.length > 0) out.push(text);
        }
        i = end + 1;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return out;
}

registerExtractor('pdf', async (input) => {
  const buf = bufferOf(input.content);
  if (isPdfBuffer(buf)) {
    const chunks: ExtractedChunk[] = [];
    let page = 0;
    for (const raw of findContentStreams(buf)) {
      const data = inflateIfNeeded(raw);
      if (!isMostlyText(data)) continue;
      const text = extractPdfStrings(data.toString('latin1')).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length === 0) continue;
      page++;
      chunks.push({
        id: makeChunkId(input, page - 1),
        text,
        modality: 'pdf' as const,
        metadata: {
          filename: input.filename,
          page,
          chunkIndex: page - 1,
        },
      });
    }
    if (chunks.length > 0) return chunks;
    return [{
      id: makeChunkId(input, 0),
      text: `[PDF: ${input.filename}] (${buf.length} bytes, no extractable text — scanned-image PDF needs an external OCR pass via registerExtractor)`,
      modality: 'pdf' as const,
      metadata: { filename: input.filename, page: 1, chunkIndex: 0 },
    }];
  }
  // Fallback: plain-text buffer labelled pdf (form-feed page split).
  const content = buf.toString('utf-8');
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

// ─── Code Extractor (boundary-aware chunking) ───────────────────────────────
// Symbols are detected per line with language-agnostic patterns (TS/JS, Python,
// Go, Rust, Java/C-like). Chunks pack whole symbols and never split one across
// chunks unless a single symbol exceeds maxLines. Header lines before the first
// symbol attach to the first chunk.

const CODE_SYMBOL_RES: RegExp[] = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:interface|enum|trait|struct)\s+([A-Za-z_$][\w$]*)/,
  // const/let/var and type aliases only count at top level (column 0):
  // indented declarations inside a function body belong to that symbol.
  /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
  /^(?:export\s+)?(?:async\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^\s*def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/,
];

const CODE_CLIKE_METHOD_RE =
  /^\s*(?:(?:public|private|protected|static|final|async|override|virtual)\s+)*(?:[\w<>\[\].,?*]+\s+)([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|throws|:)/;

const NON_SYMBOL_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'with', 'using', 'sizeof',
]);

function detectSymbol(line: string): string | undefined {
  for (const re of CODE_SYMBOL_RES) {
    const m = line.match(re);
    if (m?.[1] !== undefined && !NON_SYMBOL_KEYWORDS.has(m[1])) return m[1];
  }
  const cm = line.match(CODE_CLIKE_METHOD_RE);
  if (cm?.[1] !== undefined && !NON_SYMBOL_KEYWORDS.has(cm[1])) return cm[1];
  return undefined;
}

interface CodeBlock {
  start: number;
  end: number;
  name: string | undefined;
}

registerExtractor('code', async (input) => {
  const content = typeof input.content === 'string' ? input.content : input.content.toString('utf-8');
  if (content.trim().length === 0) return [];
  const lines = content.split('\n');
  const maxLines = 100;

  const starts: { line: number; name: string }[] = [];
  lines.forEach((ln, i) => {
    const name = detectSymbol(ln);
    if (name !== undefined) starts.push({ line: i, name });
  });

  const blocks: CodeBlock[] = [];
  if (starts.length === 0) {
    blocks.push({ start: 0, end: lines.length, name: undefined });
  } else {
    for (let k = 0; k < starts.length; k++) {
      blocks.push({
        start: k === 0 ? 0 : starts[k].line,
        end: k + 1 < starts.length ? starts[k + 1].line : lines.length,
        name: starts[k].name,
      });
    }
  }

  const chunks: ExtractedChunk[] = [];
  let idx = 0;
  const pushChunk = (chunkLines: string[], startLine: number, section: string | undefined): void => {
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
    idx++;
  };

  let cur: string[] = [];
  let curStart = 0;
  let curSection: string | undefined;
  const flush = (): void => {
    if (cur.length > 0) {
      pushChunk(cur, curStart, curSection);
      cur = [];
    }
  };

  for (const b of blocks) {
    const blines = lines.slice(b.start, b.end);
    if (blines.length > maxLines) {
      flush();
      for (let s = b.start; s < b.end; s += maxLines) {
        pushChunk(lines.slice(s, Math.min(s + maxLines, b.end)), s, b.name);
      }
      cur = [];
      curSection = undefined;
      continue;
    }
    if (cur.length + blines.length > maxLines && cur.length > 0) {
      flush();
    }
    if (cur.length === 0) {
      curStart = b.start;
      curSection = b.name;
    }
    cur.push(...blines);
  }
  flush();
  return chunks;
});

// ─── Image Extractor (embedded text metadata) ──────────────────────────────
// Reads text carried inside the file itself: PNG tEXt/iTXt keywords, JPEG COM
// segments, SVG text/title/desc elements. Pixel OCR needs an external engine —
// plug it via registerExtractor().

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface EmbeddedText {
  keyword: string;
  text: string;
}

function extractPngTexts(buf: Buffer): EmbeddedText[] {
  const out: EmbeddedText[] = [];
  if (buf.length < 8) return out;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return out;
  }
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    if (len > 100_000_000) break;
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const next = pos + 12 + len;
    if (next > buf.length) break;
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0) {
        out.push({
          keyword: data.subarray(0, nul).toString('latin1'),
          text: data.subarray(nul + 1).toString('latin1'),
        });
      }
    } else if (type === 'iTXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 3 < data.length) {
        const compFlag = data[nul + 1];
        let p = nul + 3;
        const langEnd = data.indexOf(0, p);
        if (langEnd !== -1) {
          const keyEnd = data.indexOf(0, langEnd + 1);
          if (keyEnd !== -1) {
            const rawText = data.subarray(keyEnd + 1);
            out.push({
              keyword: data.subarray(0, nul).toString('utf-8'),
              text: compFlag === 0 ? rawText.toString('utf-8') : `[compressed iTXt, ${rawText.length} bytes]`,
            });
          }
        }
      }
    }
    pos = next;
    if (type === 'IEND') break;
  }
  return out;
}

function extractJpegComments(buf: Buffer): string[] {
  const out: string[] = [];
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    let marker = buf[pos + 1];
    while (marker === 0xff && pos + 4 <= buf.length) {
      pos++;
      marker = buf[pos + 1];
    }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) break;
    if (marker === 0xfe) {
      const text = buf.subarray(pos + 4, pos + 2 + len).toString('latin1').replace(/\0/g, '').trim();
      if (text.length > 0) out.push(text);
    }
    pos += 2 + len;
  }
  return out;
}

function extractSvgTexts(s: string): string[] {
  const out: string[] = [];
  const re = /<(?:text|title|desc)[^>]*>([\s\S]*?)<\/(?:text|title|desc)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const text = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 0) out.push(text);
  }
  return out;
}

registerExtractor('image', async (input) => {
  const buf = bufferOf(input.content);
  const found: EmbeddedText[] = [];
  for (const t of extractPngTexts(buf)) {
    if (t.text.trim().length > 0) found.push({ keyword: t.keyword, text: `${t.keyword}: ${t.text}` });
  }
  for (const c of extractJpegComments(buf)) {
    found.push({ keyword: 'comment', text: c });
  }
  if (found.length === 0 && buf.length > 0) {
    const asText = buf.toString('utf-8');
    if (asText.includes('<svg')) {
      for (const t of extractSvgTexts(asText)) {
        found.push({ keyword: 'svg', text: t });
      }
    }
  }
  if (found.length > 0) {
    return found.map((f, i) => ({
      id: makeChunkId(input, i),
      text: f.text,
      modality: 'image' as const,
      metadata: {
        filename: input.filename,
        section: f.keyword,
        chunkIndex: i,
      },
    }));
  }
  return [{
    id: makeChunkId(input, 0),
    text: `[Image: ${input.filename}] (${buf.length} bytes, no embedded text metadata; pixel OCR engine not bundled — override via registerExtractor)`,
    modality: 'image' as const,
    metadata: {
      filename: input.filename,
      chunkIndex: 0,
    },
  }];
});

// ─── Video/Audio Extractor (transcript cues, else honest placeholder) ────────
// Transcript sidecars (SRT/WebVTT text) parse into timestamped chunks; raw binary
// media yields a size placeholder. Speech-to-text needs an external engine.

interface TranscriptCue {
  start: string;
  end: string;
  body: string;
}

function parseTranscriptCues(text: string): TranscriptCue[] {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (clean.length === 0 || !clean.includes('-->')) return [];
  const cues: TranscriptCue[] = [];
  const blocks = clean.split(/\r?\n\r?\n/);
  if (/^WEBVTT/m.test(clean)) {
    for (const b of blocks) {
      const lines = b.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('NOTE'));
      if (lines.length === 0) continue;
      if (/^WEBVTT/.test(lines[0])) {
        lines.shift();
        if (lines.length === 0) continue;
      }
      const tm = lines[0].match(/(\d{2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\S+)/);
      if (!tm) continue;
      const body = lines.slice(1).join(' ').trim();
      if (body.length > 0) cues.push({ start: tm[1], end: tm[2], body });
    }
    return cues;
  }
  for (const b of blocks) {
    const lines = b.split(/\r?\n/);
    if (lines.length < 3 || !/^\d+$/.test(lines[0].trim())) continue;
    const tm = lines[1].match(/(.+?)\s*-->\s*(.+)/);
    if (!tm) continue;
    const body = lines.slice(2).join(' ').trim();
    if (body.length > 0) cues.push({ start: tm[1].trim(), end: tm[2].trim(), body });
  }
  return cues;
}

async function extractTranscript(
  input: MultimodalInput,
  kind: 'video' | 'audio',
  label: string,
): Promise<ExtractedChunk[]> {
  const buf = bufferOf(input.content);
  const cues = parseTranscriptCues(buf.toString('utf-8'));
  if (cues.length > 0) {
    const perChunk = 10;
    const out: ExtractedChunk[] = [];
    for (let g = 0; g < cues.length; g += perChunk) {
      const slice = cues.slice(g, g + perChunk);
      const first = slice[0];
      const last = slice[slice.length - 1];
      out.push({
        id: makeChunkId(input, g / perChunk),
        text: slice.map((c) => `[${c.start} --> ${c.end}] ${c.body}`).join('\n'),
        modality: kind,
        metadata: {
          filename: input.filename,
          section: `${first.start} --> ${last.end}`,
          chunkIndex: g / perChunk,
        },
      });
    }
    return out;
  }
  return [{
    id: makeChunkId(input, 0),
    text: `[${label}: ${input.filename}] (${buf.length} bytes, no transcript sidecar; speech-to-text engine not bundled — override via registerExtractor)`,
    modality: kind,
    metadata: {
      filename: input.filename,
      chunkIndex: 0,
    },
  }];
}

registerExtractor('video', async (input) => extractTranscript(input, 'video', 'Video'));

registerExtractor('audio', async (input) => extractTranscript(input, 'audio', 'Audio'));

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
