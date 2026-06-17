import type { EditBlock, TimelineBookmark } from '../types/editSession'
import {
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
  resolveCompositionPlayhead,
  type CompositionTimelineSegment,
} from '../editor/scene/timelineLayout'

export type { CompositionTimelineSegment }
export { buildCompositionTimelineSegments, getCompositionTotalDuration, resolveCompositionPlayhead }

export const BASE_PX_PER_SEC = 24
export const TRACK_GAP_PX = 8
export const TRACK_OFFSET_PX = 4
export const TIMELINE_SIDEBAR_WIDTH_PX = 112

/** 源素材裁剪长度（不含变速） */
export const blockSourceTrimDuration = (block: EditBlock): number => {
  const trimmed = block.trim.out_sec - block.trim.in_sec
  if (trimmed > 0) return trimmed
  return block.duration_sec > 0 ? block.duration_sec : 5
}

export const blockPlaybackRate = (block: EditBlock): number => {
  const rate = block.playback_rate ?? 1
  return rate > 0 ? Math.min(4, Math.max(0.25, rate)) : 1
}

/** 合成时间轴上的片段时长（含变速） */
export const blockDuration = (block: EditBlock): number =>
  blockSourceTrimDuration(block) / blockPlaybackRate(block)

/** 时间轴上片段可视起点：入点裁剪后左缘右移，而非从结尾缩短 */
export const blockTimelineVisualStartSec = (
  compositionStartSec: number,
  block: EditBlock
): number => compositionStartSec + block.trim.in_sec / blockPlaybackRate(block)

export interface TimelineSegment {
  block: EditBlock
  startSec: number
  endSec: number
  duration: number
  left: number
  width: number
}

export function buildTimelineSegments(
  blocks: EditBlock[],
  pxPerSec: number
): TimelineSegment[] {
  let offset = TRACK_OFFSET_PX
  let cursor = 0
  return blocks.map((block) => {
    const duration = blockDuration(block)
    const width = duration * pxPerSec
    const segment: TimelineSegment = {
      block,
      startSec: cursor,
      endSec: cursor + duration,
      duration,
      left: offset,
      width,
    }
    offset += width + TRACK_GAP_PX
    cursor += duration
    return segment
  })
}

export function getTotalDuration(blocks: EditBlock[]): number {
  return blocks.reduce((sum, block) => sum + blockDuration(block), 0)
}

export function resolveSequencePlayhead(
  sequencePlayheadSec: number,
  segments: TimelineSegment[]
): { segment: TimelineSegment; relativeSec: number } | null {
  if (segments.length === 0) return null
  const clamped = Math.max(0, sequencePlayheadSec)
  for (const segment of segments) {
    if (clamped < segment.endSec || segment === segments[segments.length - 1]) {
      const relativeSec = Math.min(
        Math.max(0, clamped - segment.startSec),
        segment.duration
      )
      return { segment, relativeSec }
    }
  }
  const last = segments[segments.length - 1]
  return { segment: last, relativeSec: last.duration }
}

/** 根据播放头在片段左/右半区，决定新视频插入到 sequence 的下标 */
export function resolveInsertIndexForPlayhead(
  blocks: EditBlock[],
  playheadSec: number,
  transitionDurationSec: number,
  blockGaps?: number[]
): number {
  if (blocks.length === 0) return 0

  const segments = buildCompositionTimelineSegments(
    blocks,
    BASE_PX_PER_SEC,
    transitionDurationSec,
    blockGaps
  )
  const resolved = resolveCompositionPlayhead(playheadSec, segments)
  if (!resolved) return blocks.length

  const index = blocks.findIndex((block) => block.id === resolved.segment.block.id)
  if (index < 0) return blocks.length

  const midpoint = resolved.segment.duration / 2
  return resolved.relativeSec < midpoint ? index : index + 1
}

/** 轨道内容列内：时间 → 像素（片段/标尺/书签 left） */
export function timelineContentLeftPx(timeSec: number, pxPerSec: number): number {
  return TRACK_OFFSET_PX + Math.max(0, timeSec) * pxPerSec
}

/** 整格网格内：播放头 left（含侧栏宽度） */
export function timelinePlayheadLeftPx(timeSec: number, pxPerSec: number): number {
  return TIMELINE_SIDEBAR_WIDTH_PX + timelineContentLeftPx(timeSec, pxPerSec)
}

export function pxToSequenceSec(
  clientX: number,
  contentLaneRect: DOMRect,
  pxPerSec: number
): number {
  const x = clientX - contentLaneRect.left - TRACK_OFFSET_PX
  return Math.max(0, x / pxPerSec)
}

export interface RulerTick {
  left: number
  label: string
}

export function buildRulerTicks(totalDuration: number, pxPerSec: number): RulerTick[] {
  const minSpacingPx = 72
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  let interval = candidates[candidates.length - 1]
  for (const candidate of candidates) {
    if (candidate * pxPerSec >= minSpacingPx) {
      interval = candidate
      break
    }
  }

  const ticks: RulerTick[] = []
  for (let sec = 0; sec <= totalDuration + 0.001; sec += interval) {
    ticks.push({
      left: TRACK_OFFSET_PX + sec * pxPerSec,
      label: formatTimecode(sec),
    })
  }
  return ticks
}

export function formatTimecode(totalSec: number, fps = 30): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const mm = Math.floor(sec / 60)
  const ss = sec % 60
  const ff = Math.min(fps - 1, Math.floor((totalSec - sec) * fps))
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`
}

export const SNAP_GRID_SEC = 0.1
export const DEFAULT_SNAP_THRESHOLD_SEC = 0.12

export function collectSequenceSnapPoints(
  segments: Array<{ startSec: number; endSec: number }>,
  bookmarks: TimelineBookmark[] = []
): number[] {
  const points = new Set<number>([0])
  for (const segment of segments) {
    points.add(segment.startSec)
    points.add(segment.endSec)
  }
  for (const bookmark of bookmarks) {
    points.add(bookmark.time_sec)
  }
  return Array.from(points).sort((a, b) => a - b)
}

export function collectTrimSnapPoints(
  maxDur: number,
  srtBoundaries: number[] = []
): number[] {
  const points = new Set<number>([0, maxDur])
  for (const boundary of srtBoundaries) {
    if (boundary >= 0 && boundary <= maxDur) {
      points.add(boundary)
    }
  }
  return Array.from(points).sort((a, b) => a - b)
}

export function snapTime(
  time: number,
  snapPoints: number[],
  enabled: boolean,
  threshold = DEFAULT_SNAP_THRESHOLD_SEC
): number {
  if (!enabled) return time
  let best = time
  let bestDist = threshold
  for (const point of snapPoints) {
    const dist = Math.abs(point - time)
    if (dist < bestDist) {
      bestDist = dist
      best = point
    }
  }
  const grid = Math.round(time / SNAP_GRID_SEC) * SNAP_GRID_SEC
  const gridDist = Math.abs(grid - time)
  if (gridDist < bestDist) {
    best = grid
  }
  return best
}
