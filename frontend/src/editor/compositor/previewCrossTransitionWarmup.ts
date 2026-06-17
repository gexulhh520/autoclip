import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import {
  buildCompositionTimeline,
  resolveCrossTransitionWindow,
} from '../scene/timelineLayout'

/** 转场窗口开始前预热下一段解码器（秒） */
export const PREVIEW_CROSS_WARMUP_SEC = 1.25

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/** 即将进入叠化转场时，返回需要提前挂载到空闲槽位的下一段 */
export function findUpcomingCrossIncomingBlock(
  session: EditSession,
  compositionSec: number,
  lookaheadSec = PREVIEW_CROSS_WARMUP_SEC
): EditBlock | null {
  const timeline = buildCompositionTimeline(
    session.sequence,
    transitionDurationSec(session),
    session.sequence_block_gaps
  )

  for (let index = 0; index < timeline.segments.length - 1; index += 1) {
    const outgoing = timeline.segments[index]!
    if (!isCrossTransition(outgoing.transitionOut) || outgoing.dissolveOutSec <= 0) continue

    const incoming = timeline.segments[index + 1]!
    const window = resolveCrossTransitionWindow(outgoing, incoming)
    if (!window) continue

    if (
      compositionSec >= window.startSec - lookaheadSec &&
      compositionSec < window.startSec - 0.02
    ) {
      return incoming.block
    }
  }

  return null
}
