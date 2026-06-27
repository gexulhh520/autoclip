import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import { resolveMainTrackSequentialBlocks } from '../videoTracks'
import {
  buildCompositionTimeline,
  resolveCrossTransitionWindow,
} from '../scene/timelineLayout'
import { crossTransitionWarmupStartSec } from '../compositor/crossTransitionPlayback'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/**
 * 转场窗口开始前懒预热 incoming：仅 bind + seek 首帧，不提前播放。
 */
export function findUpcomingCrossIncomingBlock(
  session: EditSession,
  compositionSec: number
): EditBlock | null {
  const timeline = buildCompositionTimeline(
    resolveMainTrackSequentialBlocks(session),
    transitionDurationSec(session),
    session.sequence_block_gaps
  )

  for (let index = 0; index < timeline.segments.length - 1; index += 1) {
    const outgoing = timeline.segments[index]!
    if (!isCrossTransition(outgoing.transitionOut) || outgoing.dissolveOutSec <= 0) continue

    const incoming = timeline.segments[index + 1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)
    if (!window) continue

    const warmupStartSec = crossTransitionWarmupStartSec(
      window.startSec,
      outgoing.dissolveOutSec
    )

    if (
      compositionSec >= warmupStartSec - 0.001 &&
      compositionSec < window.startSec - 0.02
    ) {
      return incoming.block
    }
  }

  return null
}
