export interface ReleaseAsset {
  url?: string;
  sha256?: string;
}

export interface ReleaseConfig {
  version?: string;
  repository?: string;
  description?: string;
  license?: string;
  assets?: Record<string, ReleaseAsset>;
}

export function validateReleaseConfig(config: ReleaseConfig | null | undefined): string[];
export function generateHomebrewFormula(config: ReleaseConfig): string;
export function generateScoopManifest(config: ReleaseConfig): string;
