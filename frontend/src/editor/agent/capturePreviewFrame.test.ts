import { describe, expect, it } from 'vitest'
import {
  clampCaptureTimeSec,
  DEFAULT_CAPTURE_MAX_WIDTH,
  resolveCaptureMaxWidth,
} from './capturePreviewFrameUtils'
import { sanitizeToolResultForChat } from './sanitizeToolResultForChat'

describe('capturePreviewFrameUtils', () => {
  it('clamps capture time', () => {
    expect(clampCaptureTimeSec(-1, 10)).toBe(0)
    expect(clampCaptureTimeSec(12, 10)).toBe(10)
    expect(clampCaptureTimeSec(3.5, 10)).toBe(3.5)
  })

  it('resolves max width', () => {
    expect(resolveCaptureMaxWidth(undefined)).toBe(DEFAULT_CAPTURE_MAX_WIDTH)
    expect(resolveCaptureMaxWidth(480)).toBe(480)
    expect(resolveCaptureMaxWidth(-1)).toBe(DEFAULT_CAPTURE_MAX_WIDTH)
  })
})

describe('sanitizeToolResultForChat', () => {
  it('strips capture preview image payload from chat history', () => {
    const sanitized = sanitizeToolResultForChat('capture_preview_frame', {
      ok: true,
      tool_name: 'capture_preview_frame',
      data: {
        time_sec: 1,
        width: 720,
        height: 1280,
        image_base64: 'data:image/jpeg;base64,abc',
      },
    })
    expect(JSON.parse(sanitized)).toMatchObject({
      ok: true,
      data: {
        time_sec: 1,
        width: 720,
        height: 1280,
        image_base64: '[jpeg 720x1280 omitted]',
      },
    })
  })
})
