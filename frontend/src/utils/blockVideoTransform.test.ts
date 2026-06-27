import { describe, expect, it } from 'vitest'
import {
  buildDefaultOverlayPictureInPictureTransform,
  buildLegacyDefaultOverlayPictureInPictureTransform,
  DEFAULT_BLOCK_VIDEO_TRANSFORM,
  isFullScreenBlockVideoTransform,
  isLegacyDefaultOverlayPictureInPictureTransform,
  normalizeLegacyOverlayPictureInPictureTransforms,
} from './blockVideoTransform'
import type { EditBlock } from '../types/editSession'

describe('blockVideoTransform', () => {
  const exportSettings = {
    aspect: '9:16' as const,
    height: 1080,
    fps: 30,
    visual_filter: 'none' as const,
    fit_mode: 'contain' as const,
  }

  it('buildDefaultOverlayPictureInPictureTransform matches full-canvas main track default', () => {
    expect(buildDefaultOverlayPictureInPictureTransform(exportSettings)).toEqual(
      DEFAULT_BLOCK_VIDEO_TRANSFORM
    )
  })

  it('buildLegacyDefaultOverlayPictureInPictureTransform keeps old pip layout', () => {
    const transform = buildLegacyDefaultOverlayPictureInPictureTransform(exportSettings)
    expect(transform.scale_x).toBe(0.32)
    expect(transform.position_x).toBeGreaterThan(0)
    expect(transform.position_y).toBeGreaterThan(0)
  })

  it('normalizeLegacyOverlayPictureInPictureTransforms upgrades old overlay defaults', () => {
    const legacy = buildLegacyDefaultOverlayPictureInPictureTransform(exportSettings)
    const block: EditBlock = {
      id: 'ov-1',
      source_clip_id: 'ov-1',
      title: 'overlay',
      track_id: 'overlay-track',
      timeline_start_sec: 0,
      media: { type: 'imported_clip', path: 'clip.mp4' },
      trim: { in_sec: 0, out_sec: 5 },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
      duration_sec: 5,
      video_transform: legacy,
    }
    const session = {
      sequence: [block],
      export_settings: exportSettings,
    }

    expect(isLegacyDefaultOverlayPictureInPictureTransform(legacy, exportSettings)).toBe(true)
    expect(normalizeLegacyOverlayPictureInPictureTransforms(session)).toBe(true)
    expect(block.video_transform).toEqual(DEFAULT_BLOCK_VIDEO_TRANSFORM)
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
