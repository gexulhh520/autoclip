import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./desktopMode', () => ({
  isTauriApp: vi.fn(() => true),
}))

import { isTauriApp } from './desktopMode'
import { assertCompositorExportAvailable } from './compositorExportGate'

describe('compositorExportGate', () => {
  afterEach(() => {
    vi.mocked(isTauriApp).mockReturnValue(true)
  })

  it('blocks web export', () => {
    vi.mocked(isTauriApp).mockReturnValue(false)
    expect(() => assertCompositorExportAvailable(true)).toThrow(/桌面客户端/)
  })

  it('blocks desktop when compositor disabled', () => {
    expect(() => assertCompositorExportAvailable(false)).toThrow(/Compositor/)
  })
})
