import { describe, expect, it } from 'vitest'
import type { AudioClipElement, EditBlock, EditOverlayElement } from '../../types/editSession'
import {
  isPlayheadSplittableInRange,
  resolveVideoBlockSplitAt,
  splitAudioClipElement,
  splitOverlayElement,
} from './splitAtPlayhead'

describe('splitAtPlayhead', () => {
  it('isPlayheadSplittableInRange rejects edges', () => {
    expect(isPlayheadSplittableInRange(0, 10, 0.1)).toBe(false)
    expect(isPlayheadSplittableInRange(0, 10, 9.9)).toBe(false)
    expect(isPlayheadSplittableInRange(0, 10, 5)).toBe(true)
  })

  it('splitOverlayElement splits at playhead', () => {
    const overlay: EditOverlayElement = {
      id: 'txt-1',
      track_id: 'text-1',
      start_sec: 2,
      duration_sec: 6,
      params: { content: 'hello' },
    }
    const result = splitOverlayElement(overlay, 5)
    expect(result?.first.duration_sec).toBe(3)
    expect(result?.second.start_sec).toBe(5)
    expect(result?.second.duration_sec).toBe(3)
  })

  it('splitAudioClipElement adjusts trim range', () => {
    const clip: AudioClipElement = {
      id: 'audio-1',
      asset_id: 'asset-1',
      start_sec: 1,
      duration_sec: 8,
      trim_start_sec: 2,
      trim_end_sec: 10,
    }
    const result = splitAudioClipElement(clip, 5)
    expect(result?.first.duration_sec).toBe(4)
    expect(result?.first.trim_end_sec).toBe(6)
    expect(result?.second.start_sec).toBe(5)
    expect(result?.second.trim_start_sec).toBe(6)
    expect(result?.second.duration_sec).toBe(4)
  })

  it('resolveVideoBlockSplitAt accounts for playback rate', () => {
    const block: EditBlock = {
      id: 'b1',
      title: 'clip',
      source_clip_id: 'c1',
      duration_sec: 10,
      trim: { in_sec: 0, out_sec: 10 },
      playback_rate: 2,
      media: { type: 'step6_clip', path: '/a.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    expect(resolveVideoBlockSplitAt(block, 0, 2.5)).toBe(5)
  })
})
