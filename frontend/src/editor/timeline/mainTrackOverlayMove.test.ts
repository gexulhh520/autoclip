import { describe, expect, it } from 'vitest'
import type { EditBlock, EditSession } from '../../types/editSession'
import { buildCompositionTimeline } from '../scene/timelineLayout'
import { resolveMainTrackSequentialBlocks } from '../videoTracks'
import { resolveMainTrackCompositionGaps } from './sequenceBlockGaps'
import {
  applyMainSequentialBlockMoveToOverlay,
  clampMainBlockOverlayDropStartSec,
  resolveMainTrackOverlayDropStartSec,
} from './mainTrackOverlayMove'
import { resolveMainTrackBlockVisualStartSec } from './mainTrackBlockGapDrag'
import { blockTimelineVisualStartSec } from '../../utils/editTimeline'

const block = (id: string, durationSec: number, trackId = 'default-video'): EditBlock => ({
  id,
  source_clip_id: id,
  title: id,
  track_id: trackId,
  media: { type: 'step6_clip', path: `${id}.mp4` },
  trim: { in_sec: 0, out_sec: durationSec },
  overlay: { outline: '', content: [], recommend_reason: '' },
  audio: { volume: 1 },
  transition_out: 'cut',
  duration_sec: durationSec,
})

const sessionWith = (blocks: EditBlock[], videoTracks?: EditSession['video_tracks']): EditSession =>
  ({
    schema_version: 3,
    id: 's1',
    project_id: 'p1',
    name: 'test',
    overlay_snapshot: {},
    sequence: blocks,
    sequence_block_gaps: [0, 0],
    video_tracks: videoTracks ?? [
      { id: 'default-video', name: 'Video', order: 0, hidden: false, muted: false },
      { id: 'overlay-1', name: '叠画', order: 1, hidden: false, muted: false },
    ],
    export_settings: {
      aspect: '16:9',
      height: 1080,
      fps: 30,
      visual_filter: 'none',
      fit_mode: 'contain',
    },
    audio_settings: {
      bgm_volume: 0.3,
      fade_in_sec: 0.3,
      fade_out_sec: 0.3,
      use_source_video: true,
      transition_duration_sec: 0.35,
    },
    created_at: '',
    updated_at: '',
  }) as EditSession

describe('mainTrackOverlayMove', () => {
  it('applyMainSequentialBlockMoveToOverlay preserves following main block timing', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    const before = buildCompositionTimeline(
      mainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, mainBlocks)
    )
    const cStartBefore = before.segments[2]!.compositionStartSec

    expect(applyMainSequentialBlockMoveToOverlay(session, 'b', 'overlay-1')).toBe(true)

    expect(session.sequence.map((item) => item.id)).toEqual(['a', 'c', 'b'])
    const moved = session.sequence.find((item) => item.id === 'b')!
    expect(moved.track_id).toBe('overlay-1')
    expect(moved.timeline_start_sec).toBeCloseTo(5, 3)

    const afterMainBlocks = resolveMainTrackSequentialBlocks(session)
    const after = buildCompositionTimeline(
      afterMainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, afterMainBlocks)
    )
    expect(after.segments.map((segment) => segment.block.id)).toEqual(['a', 'c'])
    expect(after.segments[1]!.compositionStartSec).toBeCloseTo(cStartBefore, 3)
  })

  it('clampMainBlockOverlayDropStartSec avoids overlap on overlay track', () => {
    const session = sessionWith([
      block('a', 5),
      block('b', 5),
      block('x', 4, 'overlay-1'),
    ])
    session.sequence_block_gaps = [0]
    session.sequence[2]!.timeline_start_sec = 0

    expect(
      clampMainBlockOverlayDropStartSec(session, 'b', 'overlay-1', 3)
    ).toBeCloseTo(4, 3)
  })

  it('resolveMainTrackOverlayDropStartSec anchors to main composition visual start', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    const timeline = buildCompositionTimeline(
      mainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, mainBlocks)
    )
    const bVisualStart = blockTimelineVisualStartSec(
      timeline.segments[1]!.compositionStartSec,
      timeline.segments[1]!.block
    )

    expect(resolveMainTrackOverlayDropStartSec(session, 'b', 'overlay-1')).toBeCloseTo(
      bVisualStart,
      3
    )
    expect(resolveMainTrackBlockVisualStartSec(session, 'b')).toBeCloseTo(bVisualStart, 3)
  })

  it('overlay move keeps following block when main track has leading gap', () => {
    const session = sessionWith([block('a', 5), block('b', 5), block('c', 5)])
    session.sequence_block_gaps = [1, 0]
    const mainBlocks = resolveMainTrackSequentialBlocks(session)
    const before = buildCompositionTimeline(
      mainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, mainBlocks)
    )
    const bVisualStart = blockTimelineVisualStartSec(
      before.segments[1]!.compositionStartSec,
      before.segments[1]!.block
    )
    const cStartBefore = before.segments[2]!.compositionStartSec

    applyMainSequentialBlockMoveToOverlay(session, 'b', 'overlay-1')

    const moved = session.sequence.find((item) => item.id === 'b')!
    expect(moved.timeline_start_sec).toBeCloseTo(bVisualStart, 3)

    const afterMainBlocks = resolveMainTrackSequentialBlocks(session)
    const after = buildCompositionTimeline(
      afterMainBlocks,
      0.35,
      resolveMainTrackCompositionGaps(session, afterMainBlocks)
    )
    expect(after.segments[1]!.compositionStartSec).toBeCloseTo(cStartBefore, 3)
  })
})
