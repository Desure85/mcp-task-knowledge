/**
 * Ambient declaration for the optional `service-catalog` dependency (TD-008).
 *
 * service-catalog is an optionalDependency (installed via `npm i file:../service-catalog`
 * or from the registry). The dynamic import in src/catalog/provider.ts must type-check
 * even when the package is absent. The provider casts the handle to its own
 * EmbeddedLibHandle type at the call site, so the ambient surface here stays minimal.
 */

declare module 'service-catalog/lib' {
  export interface EmbeddedCatalogHandle {
    [key: string]: unknown;
  }

  export function initEmbeddedCatalog(args: Record<string, unknown>): Promise<EmbeddedCatalogHandle>;
}
