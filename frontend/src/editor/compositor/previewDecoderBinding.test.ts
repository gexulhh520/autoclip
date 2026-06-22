import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  ensureDecoderBound,
  ensureDecoderPreloadForTargetTime,
  resolvePreviewDecoderKey,
} from './previewDecoderBinding'

const importedBlock = (id: string, path: string): EditBlock => ({
  id,
  source_clip_id: 'import-abc',
  title: id,
  media: { type: 'imported_clip', path },
  trim: { in_sec: 0, out_sec: 10 },
  overlay: { outline: '', content: [], recommend_reason: '' },
  duration_sec: 10,
})

describe('previewDecoderBinding', () => {
  it('resolvePreviewDecoderKey shares storage for same imported media path', () => {
    const path = 'edit_sessions/s1/media/clip.mp4'
    expect(resolvePreviewDecoderKey(importedBlock('b1', path))).toBe(
      resolvePreviewDecoderKey(importedBlock('b2', path))
    )
  })

  it('ensureDecoderBound skips src reset when only block id changes', () => {
    const path = 'edit_sessions/s1/media/clip.mp4'
    const video = { src: '', dataset: {} as DOMStringMap } as HTMLVideoElement
    const getUrl = (block: EditBlock) => `http://test/blocks/${block.id}/media`

    expect(ensureDecoderBound(video, importedBlock('b1', path), getUrl)).toBe(true)
    const firstSrc = video.src
    expect(ensureDecoderBound(video, importedBlock('b2', path), getUrl)).toBe(false)
    expect(video.src).toBe(firstSrc)
  })

  it('ensureDecoderPreloadForTargetTime upgrades preload for deep seek', () => {
    const video = { preload: 'metadata' } as HTMLVideoElement
    ensureDecoderPreloadForTargetTime(video, 60)
    expect(video.preload).toBe('auto')
  })
})
