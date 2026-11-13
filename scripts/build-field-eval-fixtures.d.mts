export interface GoldField {
  name: string;
  desc: string;
  type: string;
  group: string;
}

export interface LabelEntry {
  group: string;
  [lang: string]: string;
}

export function loadCatalogs(labelDir: string): Record<string, Map<string, string>>;
export function buildFixtures(catalogs: Record<string, Map<string, string>>): {
  langs: string[];
  gold: GoldField[];
  labels: LabelEntry[];
};
export function assertLanguages(langs: string[], allowPartial: boolean): string[];
export const EXPECTED_LANGS: string[];
