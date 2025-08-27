export interface CodeIndexStatus {
  enabled: boolean;
  filesIndexed: number;
  lastIndexedAt?: string; // ISO
}

let status: CodeIndexStatus = {
  enabled: false,
  filesIndexed: 0,
  lastIndexedAt: undefined,
};

// Inert stub: indexing is deprecated/removed from server surface.
export async function codeIndexNow(): Promise<CodeIndexStatus> {
  status = { enabled: false, filesIndexed: 0, lastIndexedAt: new Date().toISOString() };
  return status;
}

export function codeIndexStatus(): CodeIndexStatus {
  return status;
}
