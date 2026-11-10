# Blob storage (attachments, exports, backups)

`BlobProvider` is the storage contract for opaque byte payloads: attachments, exports and backups.
Tasks, documents, search and vectors keep their own collections — blobs are deliberately not the
primary store (see [ADR-009](docs/adr/0009-pluggable-storage-and-embeddings.md)).

## Implementations

| Backend | Factory | Notes |
|---|---|---|
| Local files | `createFileBlobProvider({ root, maxBytes? })` | Default for both storage profiles: `DATA_DIR/blobs` (file profile) or `<db dir>/blobs` (SQLite profile). Atomic writes, strict key validation, hidden metadata, prefix listing. |
| S3 / MinIO | `createS3BlobProvider({ endpoint, bucket, accessKeyId, secretAccessKey, region?, prefix?, pathStyle?, maxBytes? })` | SigV4 implemented locally (no SDK), lazy bucket creation, `sha256:` checksums via `x-amz-meta-sha256`, prefix listing. `capabilities.presign = false` (presigned URLs are not implemented). |

Both are exercised by the same suite, `runBlobProviderContract` in `tests/blob-provider.test.ts`.
The S3 adapter is additionally checked against a real MinIO service in CI (`bulk-smoke` job); without
`BLOB_S3_*` the MinIO part is skipped and the fake-server part still runs locally.

## Configuration from environment

```bash
export BLOB_S3_ENDPOINT=http://127.0.0.1:9000
export BLOB_S3_BUCKET=mcp-blobs
export BLOB_S3_REGION=us-east-1
export BLOB_S3_ACCESS_KEY=minioadmin
export BLOB_S3_SECRET_KEY=minioadmin
```

`s3BlobProviderConfigFromEnv()` returns `undefined` unless the endpoint, bucket, access key and secret
are all present — a partially configured S3 client is not created silently.

## Contract guarantees

- Keys are validated (`[A-Za-z0-9._-]` segments, no `..`, no absolute paths) and cannot escape the
  file root; S3 objects always live under the configured bucket/prefix.
- `put` is idempotent for identical bytes (same checksum), `delete` is idempotent (`false` when the
  key is already gone), and a missing key in `get`/`size` throws `StoreError('NOT_FOUND')`.
- Metadata carries `sha256:<hex>`; `list(prefix)` answers sorted keys with metadata.

## Manual run against MinIO

```bash
docker run --rm -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio:latest server /data
BLOB_S3_ENDPOINT=http://127.0.0.1:9000 BLOB_S3_BUCKET=blobs-test \
BLOB_S3_ACCESS_KEY=minioadmin BLOB_S3_SECRET_KEY=minioadmin \
  npx vitest run tests/blob-provider.test.ts --maxWorkers=2
```
