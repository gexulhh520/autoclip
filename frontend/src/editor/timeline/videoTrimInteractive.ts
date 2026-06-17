import type { EditBlock } from '../../types/editSession'
import {
  blockPlaybackRate,
  blockTimelineVisualEndSec,
  blockTimelineVisualStartSec,
} from '../../utils/editTimeline'

/** 拖动裁切开始时快照的边界，避免每帧 rebuild 合成时间轴 */
export interface VideoTrimInteractiveContext {
  compStart: number
  rate: number
  minVisualStart: number
  maxVisualEnd: number
  fixedOutSec: number
  fixedInSec: number
  maxDur: number
}

export function buildVideoTrimInteractiveContext(
  block: EditBlock,
  blockIndex: number,
  segments: Array<{ startSec: number; dissolveOutSec: number; block: EditBlock }>,
  maxDur: number,
  trailingGap = 0
): VideoTrimInteractiveContext | null {
  const segment = segments[blockIndex]
  if (!segment) return null
  const rate = blockPlaybackRate(block)
  const compStart = segment.startSec
  let minVisualStart = 0
  if (blockIndex > 0) {
    const prev = segments[blockIndex - 1]!
    minVisualStart = blockTimelineVisualEndSec(prev.startSec, prev.block)
  }
  let maxVisualEnd = compStart + maxDur / rate
  if (blockIndex < segments.length - 1) {
    const next = segments[blockIndex + 1]!
    maxVisualEnd =
      blockTimelineVisualStartSec(next.startSec, next.block) + trailingGap
  }
  return {
    compStart,
    rate,
    minVisualStart,
    maxVisualEnd,
    fixedOutSec: block.trim.out_sec,
    fixedInSec: block.trim.in_sec,
    maxDur,
  }
}

export function applyInteractiveVideoHeadTrim(
  block: EditBlock,
  ctx: VideoTrimInteractiveContext,
  proposedVisualStart: number
): void {
  const visualStart = Math.max(ctx.minVisualStart, proposedVisualStart)
  const maxIn = ctx.fixedOutSec - 0.1
  block.trim.in_sec = Math.max(0, Math.min((visualStart - ctx.compStart) * ctx.rate, maxIn))
  block.trim.out_sec = ctx.fixedOutSec
}

export function applyInteractiveVideoTailTrim(
  block: EditBlock,
  ctx: VideoTrimInteractiveContext,
  proposedVisualEnd: number
): void {
  const minVisualEnd = ctx.compStart + ctx.fixedInSec / ctx.rate + 0.1 / ctx.rate
  const visualEnd = Math.max(minVisualEnd, Math.min(proposedVisualEnd, ctx.maxVisualEnd))
  block.trim.in_sec = ctx.fixedInSec
  block.trim.out_sec = Math.max(
    ctx.fixedInSec + 0.1,
    Math.min((visualEnd - ctx.compStart) * ctx.rate, ctx.maxDur)
  )
}
