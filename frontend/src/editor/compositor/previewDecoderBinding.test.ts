import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import {
  blockNeedsDedicatedPreviewDecoder,
  ensureDecoderBound,
  ensureDecoderPreloadForTargetTime,
  resolvePreviewDecoderKey,
} from './previewDecoderBinding'

const importedBlock = (id: string, path: string, transition: EditBlock['transition_out'] = 'cut'): EditBlock => ({
  id,
  source_clip_id: 'import-abc',
  title: id,
  media: { type: 'imported_clip', path },
  trim: { in_sec: 0, out_sec: 10 },
  overlay: { outline: '', content: [], recommend_reason: '' },
  duration_sec: 10,
  transition_out: transition,
})

const sessionWith = (sequence: EditBlock[]): EditSession =>
  ({
    sequence,
    audio_settings: { transition_duration_sec: 0.35 },
    sequence_block_gaps: [],
  }) as EditSession

describe('previewDecoderBinding', () => {
  it('resolvePreviewDecoderKey shares storage for same imported media path', () => {
    const path = 'edit_sessions/s1/media/clip.mp4'
    const editSession = sessionWith([
      importedBlock('b1', path),
      importedBlock('b2', path),
    ])
    expect(resolvePreviewDecoderKey(importedBlock('b1', path), editSession)).toBe(
      resolvePreviewDecoderKey(importedBlock('b2', path), editSession)
    )
  })

  it('overlay imported blocks use dedicated decoders even with same media path', () => {
    const path = 'edit_sessions/s1/media/broll.mp4'
    const broll1 = {
      ...importedBlock('broll-1', path),
      track_id: 'voiceover-broll',
      timeline_start_sec: 2,
    }
    const broll2 = {
      ...importedBlock('broll-2', path),
      track_id: 'voiceover-broll',
      timeline_start_sec: 8,
    }
    const editSession = sessionWith([
      importedBlock('main-1', 'edit_sessions/s1/media/main.mp4'),
      broll1,
      broll2,
    ])
    expect(resolvePreviewDecoderKey(broll1, editSession)).toBe('block:broll-1')
    expect(resolvePreviewDecoderKey(broll2, editSession)).toBe('block:broll-2')
  })

  it('uses dedicated decoders for cross-transition neighbors on same file', () => {
    const path = 'edit_sessions/s1/media/clip.mp4'
    const editSession = sessionWith([
      importedBlock('b1', path, 'dissolve'),
      importedBlock('b2', path),
    ])
    expect(blockNeedsDedicatedPreviewDecoder(importedBlock('b1', path, 'dissolve'), editSession)).toBe(
      true
    )
    expect(blockNeedsDedicatedPreviewDecoder(importedBlock('b2', path), editSession)).toBe(true)
    expect(resolvePreviewDecoderKey(importedBlock('b1', path, 'dissolve'), editSession)).toBe(
      'block:b1'
    )
    expect(resolvePreviewDecoderKey(importedBlock('b2', path), editSession)).toBe('block:b2')
  })

  it('ensureDecoderBound skips src reset when only block id changes', () => {
    const path = 'edit_sessions/s1/media/clip.mp4'
    const editSession = sessionWith([
      importedBlock('b1', path),
      importedBlock('b2', path),
    ])
    const video = { src: '', dataset: {} as DOMStringMap } as HTMLVideoElement
    const getUrl = (block: EditBlock) => `http://test/blocks/${block.id}/media`

    expect(ensureDecoderBound(video, importedBlock('b1', path), getUrl, editSession)).toBe(true)
    const firstSrc = video.src
    expect(ensureDecoderBound(video, importedBlock('b2', path), getUrl, editSession)).toBe(false)
    expect(video.src).toBe(firstSrc)
  })

  it('ensureDecoderPreloadForTargetTime upgrades preload for deep seek', () => {
    const video = { preload: 'metadata' } as HTMLVideoElement
    ensureDecoderPreloadForTargetTime(video, 60)
    expect(video.preload).toBe('auto')
  })
})
