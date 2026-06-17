import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import {
  buildCompositionTimeline,
  findCrossTransitionAtTime,
  resolveCrossTransitionWindow,
} from '../scene/timelineLayout'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/** 转场窗口开始前预加载下一段（秒） */
export const PREVIEW_TRANSITION_PREFETCH_SEC = 0.75

export function collectTransitionPrefetchBlockIds(
  session: EditSession,
  compositionSec: number,
  lookaheadSec = PREVIEW_TRANSITION_PREFETCH_SEC
): string[] {
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )

  const ids = new Set<string>()
  const probeTimes = [compositionSec, compositionSec + lookaheadSec * 0.5, compositionSec + lookaheadSec]

  for (const timeSec of probeTimes) {
    const cross = findCrossTransitionAtTime(timeline, timeSec)
    if (cross) {
      ids.add(cross.outgoing.block.id)
      ids.add(cross.incoming.block.id)
      continue
    }

    for (let index = 0; index < timeline.segments.length - 1; index += 1) {
      const outgoing = timeline.segments[index]!
      if (!isCrossTransition(outgoing.transitionOut)) continue
      const incoming = timeline.segments[index + 1]!
      const window = resolveCrossTransitionWindow(outgoing, incoming)
      if (!window) continue
      if (
        compositionSec >= window.startSec - lookaheadSec &&
        compositionSec < window.startSec
      ) {
        ids.add(outgoing.block.id)
        ids.add(incoming.block.id)
      }
    }
  }

  return [...ids]
}

export function activeCrossBlockIds(session: EditSession, compositionSec: number): string[] {
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )
  const cross = findCrossTransitionAtTime(timeline, compositionSec)
  if (!cross) return []
  return [cross.outgoing.block.id, cross.incoming.block.id]
}
