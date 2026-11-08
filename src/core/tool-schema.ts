/**
 * AC-04b — the real JSON Schema of a tool's `inputSchema`.
 *
 * `tool_schema(name)` used to return the raw Zod shape straight from the registry: JSON-serialised
 * it is a pile of `_def`/`_zod` internals, so the only readable part was the `example` built by
 * `buildExampleFor` (with the `"example"` stub for non-scalar arguments). A client asking for a
 * schema therefore got an example, not a schema.
 *
 * The SDK already converts schemas for `tools/list`; its helper is not part of the package
 * `exports` map, so it is loaded from the installed SDK by absolute path once per process. If the
 * module ever moves (SDK upgrade), `loadJsonSchemaConverter` returns `null`, the handler falls
 * back to a minimal object schema built from the shape's keys, and the fallback carries
 * `x-schema-source: fallback` so it is visible rather than silent. `tests/tool-schema.test.ts`
 * guards both paths.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z as z3 } from 'zod/v3';
import { z as z4 } from 'zod';
import { readInputShape } from './tool-arguments.js';

type JsonSchemaConverter = (schema: unknown) => Record<string, unknown>;

let converterPromise: Promise<JsonSchemaConverter | null> | undefined;

/** Locate the installed SDK package root without relying on its `exports` map. */
function resolveSdkRoot(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    let dir = path.dirname(require.resolve('@modelcontextprotocol/sdk/package.json'));
    for (let depth = 0; depth < 8; depth++) {
      const manifest = path.join(dir, 'package.json');
      if (fs.existsSync(manifest)) {
        try {
          if (JSON.parse(fs.readFileSync(manifest, 'utf8')).name === '@modelcontextprotocol/sdk') return dir;
        } catch {
          // Keep walking: a broken manifest further up is not our problem.
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Package not resolvable from here — the caller falls back to the minimal schema.
  }
  return undefined;
}

/** Load `toJsonSchemaCompat` once; `null` means "not available, use the fallback". */
export function loadJsonSchemaConverter(): Promise<JsonSchemaConverter | null> {
  if (!converterPromise) {
    converterPromise = (async () => {
      const root = resolveSdkRoot();
      if (!root) return null;
      const modulePath = path.join(root, 'dist/esm/server/zod-json-schema-compat.js');
      if (!fs.existsSync(modulePath)) return null;
      try {
        const loaded = await import(pathToFileURL(modulePath).href);
        return typeof loaded.toJsonSchemaCompat === 'function' ? (loaded.toJsonSchemaCompat as JsonSchemaConverter) : null;
      } catch {
        return null;
      }
    })();
  }
  return converterPromise;
}

/** Whether every key of the shape is optional, so the fallback can still report `required`. */
function isOptionalSchema(schema: unknown): boolean {
  const candidate = schema as { isOptional?: () => boolean; safeParse?: (value: unknown) => { success: boolean } };
  if (typeof candidate?.isOptional === 'function') return candidate.isOptional();
  if (typeof candidate?.safeParse === 'function') return candidate.safeParse(undefined).success;
  return false;
}

/**
 * Minimal object schema used when the SDK converter is unavailable: property names and the
 * `required` list survive, which is enough for a client to build a call.
 */
export function minimalInputSchema(shape: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = { description: `parameter ${key}` };
    if (!isOptionalSchema(schema)) required.push(key);
  }
  return { type: 'object', properties, required, additionalProperties: true, 'x-schema-source': 'fallback' };
}

/**
 * JSON Schema for a registry `inputSchema` value (a raw Zod shape). Returns `undefined` when the
 * value is not a raw shape (a prebuilt schema or no schema at all).
 */
export async function jsonSchemaForTool(
  inputSchema: unknown,
): Promise<Record<string, unknown> | undefined> {
  const shape = readInputShape(inputSchema);
  if (!shape) return undefined;
  const converter = await loadJsonSchemaConverter();
  if (!converter) return minimalInputSchema(shape);
  try {
    // AC-01 established the two Zod flavours: v4 schemas carry `_zod`, v3 ones only `_def`.
    const flavourV4 = Object.values(shape).some((entry) => (entry as { _zod?: unknown })?._zod !== undefined);
    const object = flavourV4 ? z4.object(shape as z4.ZodRawShape) : z3.object(shape as z3.ZodRawShape);
    return converter(object);
  } catch {
    return minimalInputSchema(shape);
  }
}
