import type { AdaptedElement } from '../../components/editor/timeline/types'
import type { EditSession } from '../../types/editSession'
import { getAudioClipTrackId } from '../audioTracks'
import { getOverlayTrackId } from '../textTracks'

export const MIN_TIMELINE_ELEMENT_SEC = 0.2
const EPS = 0.001

export interface TimelineRange {
  id: string
  start: number
  end: number
}

export function toTimelineRange(id: string, start: number, duration: number): TimelineRange {
  const safeDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, duration)
  return { id, start, end: start + safeDuration }
}

export function rangesOverlap(a: TimelineRange, b: TimelineRange): boolean {
  return a.start < b.end - EPS && a.end > b.start + EPS
}

/** 固定时长片段能否以 proposedStart 落在轨道上（不与其他片段重叠） */
export function canPlaceAtStart(
  siblings: TimelineRange[],
  duration: number,
  proposedStart: number,
  minStart = 0
): boolean {
  const safeDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, duration)
  const start = Math.max(minStart, proposedStart)
  const candidate = toTimelineRange('__candidate__', start, safeDuration)
  return !siblings.some((sibling) => rangesOverlap(candidate, sibling))
}

export function getTrackSiblingRanges(
  elements: AdaptedElement[],
  excludeIds: string | string[]
): TimelineRange[] {
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds])
  return elements
    .filter((element) => !excluded.has(element.id))
    .map((element) => toTimelineRange(element.id, element.startTime, element.duration))
}

/** 在轨道上为固定时长找一个不重叠、且尽量接近 proposedStart 的起点 */
export function clampStartAvoidingOverlap(
  siblings: TimelineRange[],
  duration: number,
  proposedStart: number,
  minStart = 0
): number {
  const safeDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, duration)
  const sorted = [...siblings].sort((a, b) => a.start - b.start)

  const gaps: Array<{ start: number; end: number }> = []
  let cursor = minStart
  for (const sibling of sorted) {
    if (sibling.start > cursor + EPS) {
      gaps.push({ start: cursor, end: sibling.start })
    }
    cursor = Math.max(cursor, sibling.end)
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY })

  const fitsInGap = (gap: { start: number; end: number }, start: number): boolean => {
    const maxStart = gap.end - safeDuration
    return start >= gap.start - EPS && start <= maxStart + EPS
  }

  for (const gap of gaps) {
    const maxStart = gap.end - safeDuration
    if (maxStart < gap.start - EPS) continue
    if (fitsInGap(gap, proposedStart)) {
      return Math.min(maxStart, Math.max(gap.start, proposedStart))
    }
  }

  let bestStart = minStart
  let bestDistance = Math.abs(proposedStart - minStart)
  for (const gap of gaps) {
    const maxStart = gap.end - safeDuration
    if (maxStart < gap.start - EPS) continue
    for (const candidate of [gap.start, maxStart]) {
      const distance = Math.abs(proposedStart - candidate)
      if (distance < bestDistance) {
        bestDistance = distance
        bestStart = candidate
      }
    }
  }
  return bestStart
}

/** 左侧拉长 / 拖动左缘：保持 end 不变 */
export function clampResizeLeftAvoidingOverlap(
  siblings: TimelineRange[],
  fixedEnd: number,
  proposedStart: number,
  minStart = 0
): { start: number; duration: number } {
  const minDuration = MIN_TIMELINE_ELEMENT_SEC
  let start = Math.max(minStart, Math.min(proposedStart, fixedEnd - minDuration))

  for (const sibling of siblings) {
    if (rangesOverlap({ id: '', start, end: fixedEnd }, sibling) && sibling.end <= fixedEnd + EPS) {
      start = Math.max(start, sibling.end)
    }
  }

  start = Math.min(Math.max(minStart, start), fixedEnd - minDuration)
  return { start, duration: fixedEnd - start }
}

/** 右侧拉长：保持 start 不变 */
export function clampResizeRightAvoidingOverlap(
  siblings: TimelineRange[],
  fixedStart: number,
  proposedEnd: number
): number {
  const minEnd = fixedStart + MIN_TIMELINE_ELEMENT_SEC
  let end = Math.max(minEnd, proposedEnd)

  for (const sibling of siblings) {
    if (rangesOverlap({ id: '', start: fixedStart, end }, sibling) && sibling.start >= fixedStart - EPS) {
      end = Math.min(end, sibling.start)
    }
  }

  return Math.max(minEnd, end)
}

/** 固定时长拖动，或右侧拉长后的 start + duration */
export function clampElementTimingOnTrack(
  siblings: TimelineRange[],
  start: number,
  duration: number
): { start: number; duration: number } {
  let safeDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, duration)
  let safeStart = clampStartAvoidingOverlap(siblings, safeDuration, start)
  const end = clampResizeRightAvoidingOverlap(siblings, safeStart, safeStart + safeDuration)
  safeDuration = Math.max(MIN_TIMELINE_ELEMENT_SEC, end - safeStart)
  safeStart = clampStartAvoidingOverlap(siblings, safeDuration, safeStart)
  return { start: safeStart, duration: safeDuration }
}

function overlaySiblingRanges(
  session: EditSession,
  trackId: string,
  excludeOverlayId: string
): TimelineRange[] {
  return (session.overlay_elements ?? [])
    .filter(
      (element) =>
        !element.hidden &&
        getOverlayTrackId(element) === trackId &&
        element.id !== excludeOverlayId
    )
    .map((element) => toTimelineRange(element.id, element.start_sec, element.duration_sec))
}

function audioSiblingRanges(
  session: EditSession,
  trackId: string,
  excludeClipId: string
): TimelineRange[] {
  return (session.audio_elements ?? [])
    .filter(
      (clip) => !clip.hidden && getAudioClipTrackId(clip) === trackId && clip.id !== excludeClipId
    )
    .map((clip) => toTimelineRange(clip.id, clip.start_sec, clip.duration_sec))
}

export function applyOverlayElementTimingClamp(session: EditSession, elementId: string): void {
  const element = session.overlay_elements?.find((item) => item.id === elementId)
  if (!element || element.hidden) return
  const trackId = getOverlayTrackId(element)
  const siblings = overlaySiblingRanges(session, trackId, elementId)
  const { start, duration } = clampElementTimingOnTrack(
    siblings,
    element.start_sec,
    element.duration_sec
  )
  element.start_sec = start
  element.duration_sec = duration
}

export function applyAudioClipTimingClamp(session: EditSession, clipId: string): void {
  const clip = session.audio_elements?.find((item) => item.id === clipId)
  if (!clip || clip.hidden) return
  const trackId = getAudioClipTrackId(clip)
  const siblings = audioSiblingRanges(session, trackId, clipId)
  const { start, duration } = clampElementTimingOnTrack(
    siblings,
    clip.start_sec,
    clip.duration_sec
  )
  clip.start_sec = start
  clip.duration_sec = duration
}

export function clampOverlayStartOnTrack(
  session: EditSession,
  trackId: string,
  durationSec: number,
  proposedStartSec: number,
  excludeOverlayId?: string
): number {
  const siblings = (session.overlay_elements ?? [])
    .filter(
      (element) =>
        !element.hidden &&
        getOverlayTrackId(element) === trackId &&
        element.id !== excludeOverlayId
    )
    .map((element) => toTimelineRange(element.id, element.start_sec, element.duration_sec))
  return clampStartAvoidingOverlap(siblings, durationSec, proposedStartSec)
}

export function clampAudioClipStartOnTrack(
  session: EditSession,
  trackId: string,
  durationSec: number,
  proposedStartSec: number,
  excludeClipId?: string
): number {
  const siblings = (session.audio_elements ?? [])
    .filter(
      (clip) => !clip.hidden && getAudioClipTrackId(clip) === trackId && clip.id !== excludeClipId
    )
    .map((clip) => toTimelineRange(clip.id, clip.start_sec, clip.duration_sec))
  return clampStartAvoidingOverlap(siblings, durationSec, proposedStartSec)
}
