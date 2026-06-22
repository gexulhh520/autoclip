import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import {
  compositionTimeFromVideo,
  easeInOutCubic,
  readVideoSourceRelativeSec,
} from './previewPlayhead'

const block = (
  id: string,
  duration: number,
  transition: EditBlock['transition_out'] = 'cut'
): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: duration,
})

describe('previewPlayhead easing', () => {
  it('easeInOutCubic is monotonic and ends at 0 and 1', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25)
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75)
  })
})

describe('compositionTimeFromVideo', () => {
  it('does not advance playhead too fast after cross transition lead-in', () => {
    const timeline = buildCompositionTimeline(
      [block('a', 4, 'dissolve'), block('b', 3)],
      0.35
    )
    const incoming = timeline.segments[1]!
    const leadIn = 0.35
    const video = {
      currentTime: incoming.block.trim.in_sec + leadIn + 0.5,
    } as HTMLVideoElement

    const comp = compositionTimeFromVideo(
      video,
      incoming.block,
      incoming.compositionStartSec,
      false,
      { timeline, segmentIndex: incoming.index }
    )

    expect(comp).toBeCloseTo(4.675, 3)
    expect(comp).toBeLessThan(4.675 + leadIn)
  })

  it('readVideoSourceRelativeSec matches trim in point', () => {
    const clip = block('a', 4)
    clip.trim.in_sec = 1
    const video = { currentTime: 2.5 } as HTMLVideoElement
    expect(readVideoSourceRelativeSec(video, clip, false)).toBeCloseTo(1.5, 3)
  })

  it('readVideoSourceRelativeSec honors split source offset in source preview mode', () => {
    const clip = block('a', 6)
    clip.trim = { in_sec: 0, out_sec: 6 }
    clip.media.source_start_sec = 4
    clip.media.source_video_path = 'sources/main.mp4'
    const video = { currentTime: 5.5 } as HTMLVideoElement
    expect(readVideoSourceRelativeSec(video, clip, true)).toBeCloseTo(1.5, 3)
    expect(readVideoSourceRelativeSec(video, clip, false)).toBeCloseTo(5.5, 3)
  })

  it('readVideoSourceRelativeSec honors imported clip split offset', () => {
    const clip = block('import-1', 6)
    clip.source_clip_id = 'import-abc'
    clip.media = {
      type: 'imported_clip',
      path: 'edit_sessions/s1/media/import-abc.mp4',
      source_start_sec: 4,
    }
    clip.trim = { in_sec: 0, out_sec: 6 }
    const video = { currentTime: 5.5 } as HTMLVideoElement
    expect(readVideoSourceRelativeSec(video, clip, false)).toBeCloseTo(1.5, 3)
  })
})
