import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

const TMP = path.join(process.cwd(), '.tmp-tests-catalog-file')
const FILE = path.join(TMP, 'catalog.json')

async function rmrf(p: string) {
  try { await fsp.rm(p, { recursive: true, force: true }) } catch {}
}

describe('catalog provider: file-store upsert/delete persistence', () => {
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
    // minimal env for provider
    process.env.DATA_DIR = TMP
    process.env.CATALOG_MODE = 'embedded'
    process.env.CATALOG_ENABLED = '1'
    process.env.CATALOG_EMBEDDED_ENABLED = '1'
    process.env.CATALOG_EMBEDDED_STORE = 'file'
    process.env.CATALOG_EMBEDDED_FILE_PATH = FILE
  })

  it('upsert writes items to file and delete removes them', async () => {
    const { loadCatalogConfig } = await import('../src/config.js')
    const { createServiceCatalogProvider } = await import('../src/catalog/provider.js')
    const provider = createServiceCatalogProvider(loadCatalogConfig())

    // upsert
    const up = await provider.upsertServices([
      { id: 'svc-a', name: 'A', component: 'comp-a', owners: ['t1'], tags: ['x'] } as any,
      { id: 'svc-b', name: 'B', component: 'comp-b' } as any,
    ])
    expect(up.ok).toBe(true)
    expect(up.count).toBe(2)

    // file exists
    expect(fs.existsSync(FILE)).toBe(true)
    const raw = JSON.parse(await fsp.readFile(FILE, 'utf8'))
    const items = Array.isArray(raw) ? raw : raw.items
    expect(Array.isArray(items)).toBe(true)
    expect(items.find((it: any) => it.id === 'svc-a')).toBeTruthy()

    // delete one
    const del = await provider.deleteServices(['svc-a'])
    expect(del.ok).toBe(true)
    expect(del.count).toBe(1)

    const raw2 = JSON.parse(await fsp.readFile(FILE, 'utf8'))
    const items2 = Array.isArray(raw2) ? raw2 : raw2.items
    expect(items2.find((it: any) => it.id === 'svc-a')).toBeFalsy()
    expect(items2.find((it: any) => it.id === 'svc-b')).toBeTruthy()
  })
})
