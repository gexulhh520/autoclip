import type { EditBlock, EditSession } from '../../types/editSession'
import {
  blockTimelineStartSec,
  mapOverlayBlockToRelativeSource,
  resolveMainTrackBlocks,
  resolveOverlayVideoBlocks,
} from '../videoTracks'
import { blockDuration } from '../../utils/editTimeline'
import {
  buildCompositionTimeline,
  findActiveSegmentAtCompositionTime,
  findCrossTransitionAtTime,
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
} from '../scene/timelineLayout'
import { findUpcomingCrossIncomingBlock } from './previewCrossTransitionWarmup'

export interface PlayheadWarmupTarget {
  block: EditBlock
  relativeSourceSec: number
}

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/**
 * 播放头附近需静默预热的片段：当前段、叠化转场邻段、下一段（便于向前 scrub）。
 * 进入草稿或 seek 时提前挂载解码器并缓冲首帧，减少灰屏。
 */
export function findPlayheadWarmupTargets(
  session: EditSession,
  compositionSec: number
): PlayheadWarmupTarget[] {
  const mainBlocks = resolveMainTrackBlocks(session)
  if (mainBlocks.length === 0) return []

  const timeline = buildCompositionTimeline(
    mainBlocks,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const clamped = Math.max(0, Math.min(timeline.totalDurationSec, compositionSec))
  const targets: PlayheadWarmupTarget[] = []
  const seen = new Set<string>()

  const add = (block: EditBlock, relativeSourceSec: number) => {
    if (seen.has(block.id)) return
    seen.add(block.id)
    targets.push({ block, relativeSourceSec: Math.max(0, relativeSourceSec) })
  }

  const cross = findCrossTransitionAtTime(timeline, clamped)
  if (cross) {
    add(
      cross.outgoing.block,
      mapCompositionTimeToRelativeSource(cross.outgoing, clamped, timeline)
    )
    add(
      cross.incoming.block,
      mapIncomingRelativeDuringCrossTransition(cross.outgoing, cross.incoming, clamped)
    )
  } else {
    const active = findActiveSegmentAtCompositionTime(timeline, clamped)
    if (active) {
      add(active.block, mapCompositionTimeToRelativeSource(active, clamped, timeline))

      const next = timeline.segments[active.index + 1]
      if (next) {
        add(next.block, 0)
      }
    }
  }

  const crossIncoming = findUpcomingCrossIncomingBlock(session, clamped)
  if (crossIncoming) {
    add(crossIncoming, 0)
  }

  for (const block of resolveOverlayVideoBlocks(session)) {
    const startSec = blockTimelineStartSec(block)
    const durationSec = blockDuration(block)
    if (clamped < startSec || clamped >= startSec + durationSec) continue
    add(block, mapOverlayBlockToRelativeSource(block, clamped))
  }

  return targets
}

export function playheadWarmupBlockIds(session: EditSession, compositionSec: number): string[] {
  return findPlayheadWarmupTargets(session, compositionSec).map((target) => target.block.id)
}
