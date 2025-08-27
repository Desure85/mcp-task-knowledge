let status = {
    enabled: false,
    filesIndexed: 0,
    lastIndexedAt: undefined,
};
// Inert stub: indexing is deprecated/removed from server surface.
export async function codeIndexNow() {
    status = { enabled: false, filesIndexed: 0, lastIndexedAt: new Date().toISOString() };
    return status;
}
export function codeIndexStatus() {
    return status;
}
