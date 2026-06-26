import type { EditBlock } from '../../types/editSession'
import type { CompositionSegment, CompositionTimeline } from '../scene/types'
import {
  mapCompositionTimeToRelativeSource,
  mapIncomingRelativeDuringCrossTransition,
} from '../scene/timelineLayout'
import { resolveBlockMediaTimeSec } from '../../utils/resolveMediaWindow'

/** 进入转场窗口前多久开始 bind + seek incoming（懒预热，避免整段 outgoing 占用 decoder） */
export const CROSS_TRANSITION_WARMUP_LEAD_SEC = 0.5

export function crossTransitionWarmupStartSec(
  windowStartSec: number,
  dissolveOutSec: number
): number {
  return windowStartSec - Math.max(CROSS_TRANSITION_WARMUP_LEAD_SEC, dissolveOutSec + 0.1)
}

/** 转场双路层的文件内 currentTime（统一走 MediaWindow） */
export function resolveCrossTransitionLayerMediaTimeSec(
  role: 'outgoing' | 'incoming',
  outgoing: CompositionSegment,
  incoming: CompositionSegment,
  compositionSec: number,
  timeline: CompositionTimeline,
  useSourceVideo: boolean
): number {
  const block: EditBlock = role === 'outgoing' ? outgoing.block : incoming.block
  const relativeSec =
    role === 'outgoing'
      ? mapCompositionTimeToRelativeSource(outgoing, compositionSec, timeline)
      : mapIncomingRelativeDuringCrossTransition(outgoing, incoming, compositionSec)
  return resolveBlockMediaTimeSec(block, relativeSec, useSourceVideo)
}
