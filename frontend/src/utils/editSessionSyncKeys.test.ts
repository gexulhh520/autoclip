import { describe, expect, it } from 'vitest'
import type { EditSession } from '../types/editSession'
import {
  buildCanvasOverlaySyncKey,
  buildPreviewMediaSequenceKey,
  buildSequenceVideoSyncKey,
} from './editSessionSyncKeys'

const baseSession = {
  sequence: [{ id: 'b1', media: { path: 'a.mp4' }, source_clip_id: 'c1' }],
  sequence_block_gaps: [],
  audio_settings: { use_source_video: false },
  overlay_elements: [{ id: 'o1', text: 'hi' }],
} as unknown as EditSession

describe('editSessionSyncKeys', () => {
  it('sequence video key ignores overlay-only changes', () => {
    const before = buildSequenceVideoSyncKey(baseSession)
    const after = buildSequenceVideoSyncKey({
      ...baseSession,
      overlay_elements: [{ id: 'o1', text: 'changed' }],
    } as unknown as EditSession)
    expect(before).toBe(after)
  })

  it('canvas overlay key changes when overlay style changes', () => {
    const before = buildCanvasOverlaySyncKey({
      session: baseSession,
      selectedOverlayId: 'o1',
      selectedOverlayIds: ['o1'],
      selectedCaptionBlockIds: [],
      selectedVideoBlockIds: [],
      previewBurnSubtitles: true,
      captionsHidden: false,
      captionsMuted: false,
      mutedTextTrackIds: [],
    })
    const after = buildCanvasOverlaySyncKey({
      session: {
        ...baseSession,
        overlay_elements: [{ id: 'o1', text: 'changed' }],
      } as unknown as EditSession,
      selectedOverlayId: 'o1',
      selectedOverlayIds: ['o1'],
      selectedCaptionBlockIds: [],
      selectedVideoBlockIds: [],
      previewBurnSubtitles: true,
      captionsHidden: false,
      captionsMuted: false,
      mutedTextTrackIds: [],
    })
    expect(before).not.toBe(after)
  })

  it('preview media sequence key is stable for overlay edits', () => {
    const before = buildPreviewMediaSequenceKey(baseSession)
    const after = buildPreviewMediaSequenceKey({
      ...baseSession,
      overlay_elements: [{ id: 'o2' }],
    } as unknown as EditSession)
    expect(before).toBe(after)
  })
})
