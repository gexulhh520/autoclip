import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../types/editSession'
import {
  resolveBlockMediaTimeSec,
  resolveBlockMediaWindow,
  resolvePreviewMediaFileKey,
} from './resolveMediaWindow'

const step6Block = (trim: { in: number; out: number }): EditBlock => ({
  id: 'b1',
  source_clip_id: 'moment-abc',
  title: 'clip',
  media: {
    type: 'step6_clip',
    path: 'output/clips/moment-abc_title.mp4',
    source_video_path: 'metadata/sources/src1/input.mp4',
    source_start_sec: 45,
    source_end_sec: 57,
  },
  trim: { in_sec: trim.in, out_sec: trim.out },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  duration_sec: 12,
  transition_out: 'cut',
})

describe('resolveBlockMediaWindow', () => {
  it('step6 clip uses trim window within clip file', () => {
    const window = resolveBlockMediaWindow(step6Block({ in: 0, out: 10 }), false)
    expect(window.filePath).toBe('output/clips/moment-abc_title.mp4')
    expect(window.mediaStartSec).toBe(0)
    expect(window.mediaEndSec).toBe(10)
    expect(resolveBlockMediaTimeSec(step6Block({ in: 0, out: 10 }), 4, false)).toBeCloseTo(4, 3)
  })

  it('split second half keeps same file with shifted trim window', () => {
    const second = step6Block({ in: 4, out: 10 })
    const first = step6Block({ in: 0, out: 4 })
    expect(resolvePreviewMediaFileKey(first, false)).toBe(resolvePreviewMediaFileKey(second, false))
    expect(resolveBlockMediaTimeSec(second, 0, false)).toBeCloseTo(4, 3)
  })

  it('imported clip adds source_start_sec base to trim', () => {
    const block: EditBlock = {
      ...step6Block({ in: 0, out: 30 }),
      source_clip_id: 'import-abc',
      media: {
        type: 'imported_clip',
        path: 'edit_sessions/s1/media/long.mp4',
        source_start_sec: 60,
      },
    }
    const window = resolveBlockMediaWindow(block, false)
    expect(window.mediaStartSec).toBe(60)
    expect(window.mediaEndSec).toBe(90)
    expect(resolveBlockMediaTimeSec(block, 5, false)).toBeCloseTo(65, 3)
  })

  it('source preview mode uses source video path', () => {
    const block = step6Block({ in: 2, out: 8 })
    const window = resolveBlockMediaWindow(block, true)
    expect(window.filePath).toContain('metadata/sources')
    expect(window.mediaStartSec).toBe(47)
    expect(window.mediaEndSec).toBe(53)
  })
})
