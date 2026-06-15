import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('antd', () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./desktopMode', () => ({
  isTauriApp: vi.fn(() => false),
}))

import { message } from 'antd'
import {
  notifyHeadlessExportComplete,
  notifyHeadlessExportFailed,
} from './headlessExportNotifications'

describe('headlessExportNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows in-app toast on complete', async () => {
    await notifyHeadlessExportComplete('demo.mp4', 'D:/exports/demo.mp4')
    expect(message.success).toHaveBeenCalledWith('后台导出完成：demo.mp4', 4)
  })

  it('shows in-app toast on failed', async () => {
    await notifyHeadlessExportFailed('demo.mp4', '编码失败')
    expect(message.error).toHaveBeenCalledWith('后台导出失败：demo.mp4', 5)
  })
})
