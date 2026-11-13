export interface RegistryPackage {
  registryType?: string;
  registryBaseUrl?: string;
  identifier?: string;
  version?: string;
  transport?: { type?: string };
}

export interface ServerManifest {
  $schema?: string;
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string };
  packages?: RegistryPackage[];
}

export interface PackageIdentity {
  name?: string;
  version?: string;
  mcpName?: string;
}

export function validateManifest(manifest: ServerManifest | null | undefined, pkg: PackageIdentity | null | undefined): string[];
