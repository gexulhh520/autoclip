import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../types/editSession'
import {
  blockUsesMediaSourceOffset,
  blockUsesSourceVideoPreview,
  isImportedBlock,
  resolveBlockMediaTimeSec,
} from './editBlockMedia'

const aiClipBlock = (sourceStartSec: number): EditBlock => ({
  id: 'block-1',
  source_clip_id: 'moment-abc',
  title: 'AI 片段',
  media: {
    type: 'step6_clip',
    path: 'output/clips/moment-abc_title.mp4',
    source_video_path: 'sources/main.mp4',
    source_start_sec: sourceStartSec,
    source_end_sec: sourceStartSec + 12,
  },
  trim: { in_sec: 0, out_sec: 12 },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  duration_sec: 12,
})

describe('resolveBlockMediaTimeSec', () => {
  it('uses clip file timeline when not previewing source video', () => {
    const block = aiClipBlock(45)
    expect(resolveBlockMediaTimeSec(block, 3.5, false)).toBeCloseTo(3.5, 3)
    expect(blockUsesSourceVideoPreview(block, false)).toBe(false)
  })

  it('offsets by source_start_sec when previewing source video', () => {
    const block = aiClipBlock(45)
    expect(resolveBlockMediaTimeSec(block, 3.5, true)).toBeCloseTo(48.5, 3)
    expect(blockUsesSourceVideoPreview(block, true)).toBe(true)
  })

  it('respects trim.in when playing extracted clip file', () => {
    const block = aiClipBlock(45)
    block.trim.in_sec = 2
    expect(resolveBlockMediaTimeSec(block, 1.5, false)).toBeCloseTo(3.5, 3)
  })

  it('offsets imported clip after split via source_start_sec', () => {
    const block: EditBlock = {
      id: 'import-1',
      source_clip_id: 'import-abc',
      title: '长片',
      media: {
        type: 'imported_clip',
        path: 'edit_sessions/s1/media/import-abc.mp4',
        source_start_sec: 60,
      },
      trim: { in_sec: 0, out_sec: 30 },
      overlay: { outline: '', content: [], recommend_reason: '' },
      duration_sec: 90,
    }
    expect(isImportedBlock(block)).toBe(true)
    expect(blockUsesMediaSourceOffset(block, false)).toBe(true)
    expect(resolveBlockMediaTimeSec(block, 2.5, false)).toBeCloseTo(62.5, 3)
    expect(blockUsesSourceVideoPreview(block, false)).toBe(false)
  })
})
