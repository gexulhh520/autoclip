import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  computeBlockInsertMarkerSec,
  previewBlockOrder,
  resolveBlockReorderTargetIndex,
} from './blockReorderDrag'
import type { CompositionTimelineSegment } from '../scene/timelineLayout'

const block = (id: string): EditBlock =>
  ({
    id,
    title: id,
    trim: { in_sec: 0, out_sec: 3 },
    duration_sec: 3,
    overlay: { outline: '', content: [] },
  }) as EditBlock

const segment = (id: string, startSec: number, duration = 3): CompositionTimelineSegment => ({
  block: block(id),
  startSec,
  endSec: startSec + duration,
  duration,
  left: startSec,
  width: duration,
  dissolveOutSec: 0,
})

describe('blockReorderDrag', () => {
  it('previewBlockOrder moves item between indices', () => {
    expect(previewBlockOrder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(previewBlockOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('resolveBlockReorderTargetIndex uses segment midpoints', () => {
    const segments = [segment('a', 0), segment('b', 3), segment('c', 6)]
    expect(resolveBlockReorderTargetIndex(1, 0, segments)).toBe(0)
    expect(resolveBlockReorderTargetIndex(7, 0, segments)).toBe(1)
    expect(resolveBlockReorderTargetIndex(1, 2, segments)).toBe(0)
  })

  it('computeBlockInsertMarkerSec returns preview start time', () => {
    const blocks = [block('a'), block('b'), block('c')]
    const marker = computeBlockInsertMarkerSec(blocks, 0, 2, 0.35)
    expect(marker).toBeGreaterThan(0)
  })
})
