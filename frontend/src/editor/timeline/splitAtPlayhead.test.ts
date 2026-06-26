import { describe, expect, it } from 'vitest'
import type { AudioClipElement, EditBlock, EditOverlayElement } from '../../types/editSession'
import {
  isPlayheadSplittableInRange,
  resolveVideoBlockSplitAt,
  splitAudioClipElement,
  splitOverlayElement,
  splitTimelinePositionedVideoBlockAt,
  splitVideoBlockAt,
} from './splitAtPlayhead'
import { resolveBlockMediaTimeSec } from '../../utils/resolveMediaWindow'
import {
  blockDuration,
  blockTimelineVisualStartSec,
  buildCompositionTimelineSegments,
} from '../../utils/editTimeline'

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

  it('resolveVideoBlockSplitAt uses visual start when trim.in_sec > 0', () => {
    const block: EditBlock = {
      id: 'b1',
      title: 'clip',
      source_clip_id: 'c1',
      duration_sec: 10,
      trim: { in_sec: 4, out_sec: 14 },
      media: { type: 'step6_clip', path: '/a.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    expect(resolveVideoBlockSplitAt(block, 4, 6)).toBe(6)
  })

  it('splitVideoBlockAt is non-destructive and keeps same media path', () => {
    const block: EditBlock = {
      id: 'b1',
      title: 'clip',
      source_clip_id: 'c1',
      duration_sec: 10,
      trim: { in_sec: 0, out_sec: 10 },
      media: { type: 'step6_clip', path: 'output/clips/a.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    const split = splitVideoBlockAt(block, 4)
    expect(split.first.trim).toEqual({ in_sec: 0, out_sec: 4 })
    expect(split.second.trim).toEqual({ in_sec: 0, out_sec: 6 })
    expect(split.second.media.path).toBe(block.media.path)
    expect(split.second.media.clip_file_start_sec).toBe(4)
    expect(split.second.media.source_start_sec).toBeUndefined()
    expect(resolveBlockMediaTimeSec(split.second, 0, false)).toBeCloseTo(4, 3)
  })

  it('splitVideoBlockAt preserves imported source_start_sec', () => {
    const block: EditBlock = {
      id: 'import-1',
      title: '长片',
      source_clip_id: 'import-abc',
      duration_sec: 90,
      trim: { in_sec: 0, out_sec: 30 },
      media: {
        type: 'imported_clip',
        path: 'edit_sessions/s1/media/long.mp4',
        source_start_sec: 60,
      },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    const split = splitVideoBlockAt(block, 10)
    expect(split.second.trim).toEqual({ in_sec: 0, out_sec: 20 })
    expect(split.second.media.source_start_sec).toBe(70)
    expect(resolveBlockMediaTimeSec(split.second, 0, false)).toBeCloseTo(70, 3)
  })

  it('splitTimelinePositionedVideoBlockAt splits free-position block', () => {
    const block: EditBlock = {
      id: 'b1',
      title: 'clip',
      source_clip_id: 'c1',
      duration_sec: 10,
      trim: { in_sec: 0, out_sec: 10 },
      timeline_start_sec: 8,
      media: { type: 'step6_clip', path: '/a.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    const split = splitTimelinePositionedVideoBlockAt(block, 12)
    expect(split?.second.timeline_start_sec).toBe(12)
    expect(split?.second.trim.in_sec).toBe(0)
    expect(split?.second.trim.out_sec).toBe(6)
    expect(split?.second.media.clip_file_start_sec).toBe(4)
  })

  it('splitVideoBlockAt keeps sequential timeline segments contiguous', () => {
    const block: EditBlock = {
      id: 'b1',
      title: 'clip',
      source_clip_id: 'c1',
      duration_sec: 10,
      trim: { in_sec: 0, out_sec: 10 },
      media: { type: 'step6_clip', path: '/a.mp4' },
      overlay: { outline: '', content: [], recommend_reason: '' },
      audio: { volume: 1 },
      transition_out: 'cut',
    }
    const split = splitVideoBlockAt(block, 4)
    const first: EditBlock = { ...split.first, id: 'b1' }
    const second: EditBlock = { ...split.second, id: 'b2' }
    const segments = buildCompositionTimelineSegments([first, second], 24, 0.5)
    const firstEnd = blockTimelineVisualStartSec(segments[0]!.startSec, first) + blockDuration(first)
    const secondStart = blockTimelineVisualStartSec(segments[1]!.startSec, second)
    expect(firstEnd).toBeCloseTo(secondStart, 3)
  })
})
