import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./desktopMode', () => ({
  isTauriApp: vi.fn(() => true),
}))

import { isTauriApp } from './desktopMode'
import { assertDesktopExportAvailable } from './compositorExportGate'

describe('compositorExportGate', () => {
  afterEach(() => {
    vi.mocked(isTauriApp).mockReturnValue(true)
  })

  it('blocks web export', () => {
    vi.mocked(isTauriApp).mockReturnValue(false)
    expect(() => assertDesktopExportAvailable()).toThrow(/桌面客户端/)
  })

  it('allows desktop export', () => {
    expect(() => assertDesktopExportAvailable()).not.toThrow()
  })
})
