import { describe, it, expect, beforeEach, vi } from 'vitest'

// We validate flag helpers from config to ensure gating logic is correct

describe('catalog flags: read/write gating', () => {
  const ENV = process.env

  beforeEach(async () => {
    // Reset modules and env between tests
    vi.resetModules()
    process.env = { ...ENV }
    process.env.DATA_DIR = process.cwd()
    delete process.env.CATALOG_ENABLED
    delete process.env.CATALOG_READ_ENABLED
    delete process.env.CATALOG_WRITE_ENABLED
  })

  it('read defaults to true and write defaults to false when catalog is enabled', async () => {
    process.env.CATALOG_ENABLED = '1'
    const { isCatalogReadEnabled, isCatalogWriteEnabled } = await import('../src/config.js')
    expect(isCatalogReadEnabled()).toBe(true)
    expect(isCatalogWriteEnabled()).toBe(false)
  })

  it('read can be disabled explicitly', async () => {
    process.env.CATALOG_ENABLED = '1'
    process.env.CATALOG_READ_ENABLED = '0'
    const { isCatalogReadEnabled } = await import('../src/config.js')
    expect(isCatalogReadEnabled()).toBe(false)
  })

  it('write can be enabled explicitly', async () => {
    process.env.CATALOG_ENABLED = '1'
    process.env.CATALOG_WRITE_ENABLED = '1'
    const { isCatalogWriteEnabled } = await import('../src/config.js')
    expect(isCatalogWriteEnabled()).toBe(true)
  })

  it('when catalog is disabled, both read and write are false regardless of overrides', async () => {
    process.env.CATALOG_ENABLED = '0'
    process.env.CATALOG_READ_ENABLED = '1'
    process.env.CATALOG_WRITE_ENABLED = '1'
    const { isCatalogReadEnabled, isCatalogWriteEnabled } = await import('../src/config.js')
    expect(isCatalogReadEnabled()).toBe(false)
    expect(isCatalogWriteEnabled()).toBe(false)
  })
})
