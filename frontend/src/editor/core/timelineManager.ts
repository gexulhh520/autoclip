import { nanoid } from 'nanoid'
import {
  buildCompositionTimeline,
  buildCompositionTimelineSegments,
  getCompositionTotalDuration,
  resolveCompositionPlayhead,
} from '../scene/timelineLayout'
import type { EditBlock } from '../../types/editSession'
import { blockDuration } from '../../utils/editTimeline'
import type {
  DeleteBlocksOptions,
  SessionEditSnapshot,
  SplitAtPlayheadOptions,
  TimelineMutationResult,
} from './types'

const cloneSnapshot = (snapshot: SessionEditSnapshot): SessionEditSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as SessionEditSnapshot

const blockEffectiveContribution = (
  block: EditBlock,
  index: number,
  blocks: EditBlock[],
  transitionDurationSec: number
): number => {
  const timeline = buildCompositionTimeline(blocks, transitionDurationSec)
  const segment = timeline.segments[index]
  if (!segment) return blockDuration(block)
  return segment.sourceDurationSec - segment.dissolveOutSec
}

/** Ripple：删除后前移 overlay / bookmark */
const rippleShiftTimelineMeta = (
  snapshot: SessionEditSnapshot,
  rippleStartSec: number,
  removedSec: number
): void => {
  if (removedSec <= 0) return
  const rippleEnd = rippleStartSec + removedSec

  snapshot.bookmarks = snapshot.bookmarks.filter(
    (item) => item.time_sec < rippleStartSec - 0.001 || item.time_sec >= rippleEnd - 0.001
  )
  for (const bookmark of snapshot.bookmarks) {
    if (bookmark.time_sec >= rippleEnd - 0.001) {
      bookmark.time_sec = Math.max(0, bookmark.time_sec - removedSec)
    }
  }

  snapshot.overlay_elements = snapshot.overlay_elements.filter((element) => {
    const end = element.start_sec + element.duration_sec
    return end <= rippleStartSec + 0.001 || element.start_sec >= rippleEnd - 0.001
  })
  for (const element of snapshot.overlay_elements) {
    if (element.start_sec >= rippleEnd - 0.001) {
      element.start_sec = Math.max(0, element.start_sec - removedSec)
    }
  }
}

export const deleteBlocks = (
  input: SessionEditSnapshot,
  options: DeleteBlocksOptions
): TimelineMutationResult => {
  const snapshot = cloneSnapshot(input)
  const deleteSet = new Set(options.blockIds)
  if (deleteSet.size === 0) {
    return { snapshot, nextPlayhead: options.playheadSec }
  }

  const segments = buildCompositionTimelineSegments(
    snapshot.sequence,
    24,
    options.transitionDurationSec
  )
  const deletedSegments = segments.filter((item) => deleteSet.has(item.block.id))
  const rippleStart = deletedSegments.length
    ? Math.min(...deletedSegments.map((item) => item.startSec))
    : options.playheadSec

  let removedSec = 0
  if (options.ripple && deletedSegments.length > 0) {
    deletedSegments.forEach((seg) => {
      const index = snapshot.sequence.findIndex((block) => block.id === seg.block.id)
      removedSec += blockEffectiveContribution(
        seg.block,
        index,
        snapshot.sequence,
        options.transitionDurationSec
      )
    })
    rippleShiftTimelineMeta(snapshot, rippleStart, removedSec)
  }

  snapshot.sequence = snapshot.sequence.filter((block) => !deleteSet.has(block.id))
  const nextPlayhead = options.ripple
    ? Math.max(0, rippleStart)
    : Math.max(0, options.playheadSec - (options.ripple ? 0 : 0))

  const clampedPlayhead = Math.min(
    nextPlayhead,
    getCompositionTotalDuration(snapshot.sequence, options.transitionDurationSec)
  )

  return {
    snapshot,
    nextPlayhead: clampedPlayhead,
    selectedBlockId: snapshot.sequence[0]?.id ?? null,
    selectedBlockIds: snapshot.sequence[0]?.id ? [snapshot.sequence[0].id] : [],
  }
}

export const splitAtPlayhead = (
  input: SessionEditSnapshot,
  options: SplitAtPlayheadOptions
): TimelineMutationResult | null => {
  const snapshot = cloneSnapshot(input)
  const segments = buildCompositionTimelineSegments(
    snapshot.sequence,
    options.pxPerSec,
    options.transitionDurationSec
  )
  const resolved = resolveCompositionPlayhead(options.playheadSec, segments)
  if (!resolved) return null

  const block = resolved.segment.block
  const index = snapshot.sequence.findIndex((item) => item.id === block.id)
  if (index < 0) return null

  const splitAt = block.trim.in_sec + resolved.relativeSec
  if (splitAt <= block.trim.in_sec + 0.05 || splitAt >= block.trim.out_sec - 0.05) {
    return null
  }

  const current = snapshot.sequence[index]
  if (options.mode === 'left') {
    current.trim.in_sec = splitAt
    return {
      snapshot,
      nextPlayhead: resolved.segment.startSec + resolved.relativeSec,
      selectedBlockId: current.id,
      selectedBlockIds: [current.id],
    }
  }
  if (options.mode === 'right') {
    current.trim.out_sec = splitAt
    return {
      snapshot,
      nextPlayhead: resolved.segment.startSec + resolved.relativeSec,
      selectedBlockId: current.id,
      selectedBlockIds: [current.id],
    }
  }

  const second: EditBlock = {
    ...JSON.parse(JSON.stringify(current)) as EditBlock,
    id: nanoid(),
    trim: { in_sec: splitAt, out_sec: current.trim.out_sec },
  }
  current.trim.out_sec = splitAt
  snapshot.sequence.splice(index + 1, 0, second)

  return {
    snapshot,
    nextPlayhead: resolved.segment.startSec + resolved.relativeSec,
    selectedBlockId: second.id,
    selectedBlockIds: [second.id],
  }
}

export const reorderBlocks = (
  input: SessionEditSnapshot,
  fromIndex: number,
  toIndex: number
): SessionEditSnapshot => {
  const snapshot = cloneSnapshot(input)
  if (fromIndex === toIndex) return snapshot
  const next = [...snapshot.sequence]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  snapshot.sequence = next
  return snapshot
}

export const applyTrimRipple = (
  input: SessionEditSnapshot,
  blockId: string,
  trimDeltaSec: number,
  compositionTrimEndSec: number,
  transitionDurationSec: number
): SessionEditSnapshot => {
  if (trimDeltaSec <= 0.001) return input
  const snapshot = cloneSnapshot(input)
  rippleShiftTimelineMeta(snapshot, compositionTrimEndSec, trimDeltaSec)
  return snapshot
}
