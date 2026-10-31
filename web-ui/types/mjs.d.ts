/**
 * Types for the plain-JS DESIGN.md generator (`scripts/gen-design-doc.mjs`).
 *
 * The generator stays a dependency-free `.mjs` script (run by `npm run
 * design:doc`), so its public surface is declared here instead of duplicating
 * the parsing logic in TypeScript.
 */
declare module '*.mjs' {
  /** Full DESIGN.md text with both generated blocks refreshed. */
  export function renderDesignDoc(source: string): string;
  /** Content of the `generated tokens` block. */
  export function renderTokenBlock(): string;
  /** Content of the `generated primitives` block. */
  export function renderPrimitivesBlock(): string;
}
