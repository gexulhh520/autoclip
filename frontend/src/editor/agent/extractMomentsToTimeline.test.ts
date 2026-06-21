import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import type { MatchedMoment } from '../../types/editorAgent'
import { buildMomentExtractSpecs } from './extractMomentsToTimeline'

const block = (trimIn: number, trimOut: number): EditBlock => ({
  id: 'b1',
  source_clip_id: 'b1',
  title: 'input',
  media: { type: 'imported', path: 'x.mp4' },
  trim: { in_sec: trimIn, out_sec: trimOut },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: trimOut,
})

const match = (trimIn: number, trimOut: number, preview: string): MatchedMoment => ({
  start_sec: trimIn,
  end_sec: trimOut,
  timeline_start_sec: trimIn,
  timeline_end_sec: trimOut,
  trim_in_sec: trimIn,
  trim_out_sec: trimOut,
  text_preview: preview,
  match_score: 0.9,
  match_reason: preview,
  transcript_source: 'whisper',
})

describe('buildMomentExtractSpecs', () => {
  it('builds ordered trim specs from matches', () => {
    const specs = buildMomentExtractSpecs(block(0, 7200), [
      match(100, 120, '第二段'),
      match(10, 30, '第一段'),
    ])
    expect(specs).toHaveLength(2)
    expect(specs[0]?.trim_in_sec).toBe(10)
    expect(specs[1]?.trim_in_sec).toBe(100)
    expect(specs[0]?.title_suffix).toContain('第一段')
  })
})
