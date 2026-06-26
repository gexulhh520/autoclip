import { describe, expect, it } from 'vitest'
import type { EditBlock } from '../../types/editSession'
import {
  buildCompositionTimeline,
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
  resolveCrossTransitionWindow,
} from '../scene/timelineLayout'
import { resolveBlockMediaTimeSec } from '../../utils/resolveMediaWindow'
import {
  crossTransitionWarmupStartSec,
  resolveCrossTransitionLayerMediaTimeSec,
} from './crossTransitionPlayback'

const block = (
  id: string,
  duration: number,
  transition: EditBlock['transition_out'] = 'cut',
  media?: EditBlock['media']
): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  media: media ?? { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: duration },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: transition,
  duration_sec: duration,
})

describe('crossTransitionPlayback', () => {
  it('lazy warmup starts shortly before cross window', () => {
    const timeline = buildCompositionTimeline([block('a', 4, 'dissolve'), block('b', 3)], 0.35)
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)!
    const warmupStart = crossTransitionWarmupStartSec(window.startSec, outgoing.dissolveOutSec)

    expect(warmupStart).toBeGreaterThan(3)
    expect(warmupStart).toBeLessThan(window.startSec)
  })

  it('incoming at cross window start uses clip_file_start_sec via MediaWindow', () => {
    const first = block('a', 10, 'dissolve')
    first.trim = { in_sec: 0, out_sec: 4 }
    const second = block('b', 10, 'cut', {
      type: 'step6_clip',
      path: 'a.mp4',
      clip_file_start_sec: 4,
    })
    second.trim = { in_sec: 0, out_sec: 6 }

    const timeline = buildCompositionTimeline([first, second], 0.35)
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)!

    const mediaTime = resolveCrossTransitionLayerMediaTimeSec(
      'incoming',
      outgoing,
      incoming,
      window.startSec,
      timeline,
      false
    )
    expect(mediaTime).toBeCloseTo(4, 3)
  })

  it('incoming media time stays aligned with MediaWindow through transition end', () => {
    const first = block('a', 10, 'dissolve')
    first.trim = { in_sec: 0, out_sec: 4 }
    const second = block('b', 10, 'cut', {
      type: 'step6_clip',
      path: 'a.mp4',
      clip_file_start_sec: 4,
    })
    second.trim = { in_sec: 0, out_sec: 6 }

    const timeline = buildCompositionTimeline([first, second], 0.35)
    const outgoing = timeline.segments[0]!
    const incoming = timeline.segments[1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)!
    const justBeforeEnd = window.endSec - 0.001
    const justAfterEnd = window.endSec + 0.002

    const relBefore = mapIncomingRelativeDuringCrossTransition(outgoing, incoming, justBeforeEnd)
    const mediaBefore = resolveBlockMediaTimeSec(incoming.block, relBefore, false)
    const layerBefore = resolveCrossTransitionLayerMediaTimeSec(
      'incoming',
      outgoing,
      incoming,
      justBeforeEnd,
      timeline,
      false
    )
    expect(layerBefore).toBeCloseTo(mediaBefore, 3)

    const relAfter = mapCompositionTimeToRelativeSource(incoming, justAfterEnd, timeline)
    const mediaAfter = resolveBlockMediaTimeSec(incoming.block, relAfter, false)
    expect(mediaAfter).toBeGreaterThan(mediaBefore - 0.01)
    expect(mediaAfter - mediaBefore).toBeCloseTo(0.003, 3)
  })
})
