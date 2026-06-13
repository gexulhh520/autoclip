import type { EditBlock } from '../types/editSession'

export const BASE_PX_PER_SEC = 24
export const TRACK_GAP_PX = 8
export const TRACK_OFFSET_PX = 4

export const blockDuration = (block: EditBlock): number => {
  const trimmed = block.trim.out_sec - block.trim.in_sec
  if (trimmed > 0) return trimmed
  return block.duration_sec > 0 ? block.duration_sec : 5
}

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

export function pxToSequenceSec(clientX: number, laneRect: DOMRect, pxPerSec: number): number {
  const x = clientX - laneRect.left - TRACK_OFFSET_PX
  return Math.max(0, x / pxPerSec)
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

export function collectSequenceSnapPoints(segments: TimelineSegment[]): number[] {
  const points = new Set<number>([0])
  for (const segment of segments) {
    points.add(segment.startSec)
    points.add(segment.endSec)
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
