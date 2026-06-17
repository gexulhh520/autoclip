import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { findUpcomingCrossIncomingBlock } from './previewCrossTransitionWarmup'

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

const session = (sequence: EditBlock[]): EditSession =>
  ({
    sequence,
    audio_settings: { transition_duration_sec: 0.35 },
    sequence_block_gaps: {},
  }) as EditSession

describe('previewCrossTransitionWarmup', () => {
  it('returns incoming block before cross window starts', () => {
    const editSession = session([block('a', 4, 'dissolve'), block('b', 3)])
    const junction = 4
    const beforeWindow = junction - 0.35 / 2 - 0.5

    expect(findUpcomingCrossIncomingBlock(editSession, beforeWindow)?.id).toBe('b')
  })

  it('returns null once cross window has started', () => {
    const editSession = session([block('a', 4, 'dissolve'), block('b', 3)])
    const junction = 4

    expect(findUpcomingCrossIncomingBlock(editSession, junction)).toBeNull()
  })
})
