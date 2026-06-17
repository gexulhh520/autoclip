import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import {
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'
import {
  buildCompositionTimeline,
  resolveCrossTransitionWindow,
} from '../scene/timelineLayout'

const transitionDurationSec = (session: EditSession): number =>
  session.audio_settings?.transition_duration_sec ?? 0.35

/**
 * 当前正在播放带叠化转场的 outgoing 片段时，返回需静默预热的下一段。
 * 自 outgoing 可视起点起即挂载解码器（仅缓冲首帧），避免临近转场才加载闪屏。
 */
export function findUpcomingCrossIncomingBlock(
  session: EditSession,
  compositionSec: number
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

    const visualStart = blockTimelineVisualStartSec(
      outgoing.compositionStartSec,
      outgoing.block
    )

    if (
      compositionSec >= visualStart - 0.001 &&
      compositionSec < window.startSec - 0.02
    ) {
      return incoming.block
    }
  }

  return null
}
