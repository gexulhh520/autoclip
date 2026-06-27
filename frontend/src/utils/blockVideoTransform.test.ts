import { describe, expect, it } from 'vitest'
import {
  buildDefaultOverlayPictureInPictureTransform,
  DEFAULT_OVERLAY_VIDEO_SCALE,
  isFullScreenBlockVideoTransform,
} from './blockVideoTransform'

describe('blockVideoTransform', () => {
  it('buildDefaultOverlayPictureInPictureTransform returns scaled bottom-right pip', () => {
    const transform = buildDefaultOverlayPictureInPictureTransform({
      aspect: '9:16',
      height: 1080,
      fps: 30,
      visual_filter: 'none',
      fit_mode: 'contain',
    })
    expect(transform.scale_x).toBe(DEFAULT_OVERLAY_VIDEO_SCALE)
    expect(transform.scale_y).toBe(DEFAULT_OVERLAY_VIDEO_SCALE)
    expect(transform.position_x).toBeGreaterThan(0)
    expect(transform.position_y).toBeGreaterThan(0)
  })

  it('isFullScreenBlockVideoTransform detects default main-track layout', () => {
    expect(isFullScreenBlockVideoTransform(undefined)).toBe(true)
    expect(isFullScreenBlockVideoTransform({ scale_x: 1, scale_y: 1, position_x: 0, position_y: 0 })).toBe(
      true
    )
    expect(
      isFullScreenBlockVideoTransform({
        scale_x: 0.32,
        scale_y: 0.32,
        position_x: 200,
        position_y: 300,
      })
    ).toBe(false)
  })
})
