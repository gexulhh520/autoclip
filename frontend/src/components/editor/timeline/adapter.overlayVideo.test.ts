import { describe, expect, it } from 'vitest'
import type { AdaptedTrack } from './types'
import {
  findOverlayVideoTrackAtY,
  getOverlayVideoDropZoneTop,
  hasOverlayVideoTrack,
  PENDING_OVERLAY_VIDEO_TRACK_ADAPTED_ID,
  resolveOverlayVideoDropTarget,
} from './adapter'
import { getCumulativeHeightBefore } from './trackUtils'

const videoTrack = (
  id: string,
  opts: { isMain?: boolean; videoTrackId?: string; hidden?: boolean }
): AdaptedTrack => ({
  id,
  type: 'video',
  name: id,
  isMain: opts.isMain ?? false,
  muted: false,
  hidden: opts.hidden ?? false,
  videoTrackId: opts.videoTrackId ?? id,
  elements: [],
})

describe('overlay video drop helpers', () => {
  it('findOverlayVideoTrackAtY ignores main video track', () => {
    const tracks = [
      videoTrack('track-main-video', { isMain: true, videoTrackId: 'default-video' }),
      videoTrack('track-video-overlay', { videoTrackId: 'overlay-1' }),
    ]
    const yOnMain = getCumulativeHeightBefore(tracks, 0) + 8
    expect(findOverlayVideoTrackAtY(tracks, yOnMain)).toBeNull()
    const yOnOverlay = getCumulativeHeightBefore(tracks, 1) + 8
    expect(findOverlayVideoTrackAtY(tracks, yOnOverlay)?.videoTrackId).toBe('overlay-1')
  })

  it('resolveOverlayVideoDropTarget returns pending slot when no overlay track exists', () => {
    const tracks = [
      videoTrack('track-main-video', { isMain: true, videoTrackId: 'default-video' }),
      {
        id: 'track-caption',
        type: 'text' as const,
        name: 'Captions',
        isMain: false,
        muted: false,
        hidden: false,
        elements: [],
      },
    ]
    const zoneTop = getOverlayVideoDropZoneTop(tracks)
    expect(zoneTop).not.toBeNull()
    const target = resolveOverlayVideoDropTarget(tracks, zoneTop! + 8)
    expect(target?.createIfMissing).toBe(true)
    expect(target?.adaptedTrackId).toBe(PENDING_OVERLAY_VIDEO_TRACK_ADAPTED_ID)
    expect(hasOverlayVideoTrack(tracks)).toBe(false)
  })
})
