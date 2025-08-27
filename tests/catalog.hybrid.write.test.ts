import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest'
import path from 'node:path'
import fsp from 'node:fs/promises'
import fs from 'node:fs'

const TMP = path.join(process.cwd(), '.tmp-tests-catalog-hybrid')
const FILE = path.join(TMP, 'embedded.json')

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }) } catch {}
}

describe('catalog hybrid mode: writes go to embedded store', () => {
  beforeAll(async () => {
    await rmrf(TMP)
    await fsp.mkdir(TMP, { recursive: true })
  })
  afterAll(async () => {
    await rmrf(TMP)
  })
  beforeEach(async () => {
    await vi.resetModules()
    await rmrf(FILE)
    // Configure hybrid: prefer remote (even if unreachable), but embedded enabled with file store
    process.env.DATA_DIR = TMP
    process.env.CATALOG_MODE = 'hybrid'
    process.env.CATALOG_ENABLED = '1'
    process.env.CATALOG_PREFER = 'remote'
    process.env.CATALOG_REMOTE_ENABLED = '1'
    process.env.CATALOG_REMOTE_BASE_URL = 'http://127.0.0.1:59999' // likely unreachable
    process.env.CATALOG_EMBEDDED_ENABLED = '1'
    process.env.CATALOG_EMBEDDED_STORE = 'file'
    process.env.CATALOG_EMBEDDED_FILE_PATH = FILE
  })

  it('upsert persists to embedded file even if remote is preferred', async () => {
    const { loadCatalogConfig } = await import('../src/config.js')
    const { createServiceCatalogProvider } = await import('../src/catalog/provider.js')
    const provider = createServiceCatalogProvider(loadCatalogConfig())

    const up = await provider.upsertServices([
      { id: 'svc-h1', name: 'Hybrid 1', component: 'comp-h' } as any,
    ])
    expect(up.ok).toBe(true)
    expect(up.count).toBe(1)

    // File should exist and contain the item
    expect(fs.existsSync(FILE)).toBe(true)
    const raw = JSON.parse(await fsp.readFile(FILE, 'utf8'))
    const items = Array.isArray(raw) ? raw : raw.items
    expect(items.find((it: any) => it.id === 'svc-h1')).toBeTruthy()
  })
})
