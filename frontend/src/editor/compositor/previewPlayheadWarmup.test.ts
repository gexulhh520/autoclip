import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { findPlayheadWarmupTargets } from './previewPlayheadWarmup'

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

describe('previewPlayheadWarmup', () => {
  it('warms active block at playhead and the next segment', () => {
    const editSession = session([block('a', 4), block('b', 3)])
    const targets = findPlayheadWarmupTargets(editSession, 1.5)

    expect(targets.map((target) => target.block.id)).toEqual(['a', 'b'])
    expect(targets[0]?.relativeSourceSec).toBeCloseTo(1.5, 2)
    expect(targets[1]?.relativeSourceSec).toBe(0)
  })

  it('warms both sides during cross transition', () => {
    const editSession = session([block('a', 4, 'dissolve'), block('b', 3)])
    const junction = 4
    const targets = findPlayheadWarmupTargets(editSession, junction)

    expect(targets.map((target) => target.block.id)).toEqual(['a', 'b'])
  })

  it('includes upcoming cross incoming while still on outgoing clip', () => {
    const editSession = session([block('a', 4, 'dissolve'), block('b', 3)])
    const targets = findPlayheadWarmupTargets(editSession, 0.5)

    expect(targets.map((target) => target.block.id)).toContain('b')
  })
})
