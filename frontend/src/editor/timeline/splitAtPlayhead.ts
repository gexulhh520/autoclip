import type { AudioClipElement, EditBlock, EditOverlayElement, EditSession } from '../../types/editSession'
import {
  blockDuration,
  blockPlaybackRate,
  buildCompositionTimelineSegments,
} from '../../utils/editTimeline'

export const MIN_SPLIT_GAP_SEC = 0.2

export type SplitSelectionTarget =
  | { kind: 'video_block'; blockId: string }
  | { kind: 'text_overlay'; overlayId: string }
  | { kind: 'audio_clip'; clipId: string }

export function isPlayheadSplittableInRange(
  startSec: number,
  durationSec: number,
  playheadSec: number,
  minGap = MIN_SPLIT_GAP_SEC
): boolean {
  const endSec = startSec + durationSec
  return playheadSec > startSec + minGap && playheadSec < endSec - minGap
}

export function resolveSplitSelectionTarget(params: {
  session: EditSession
  playheadSec: number
  pxPerSec: number
  transitionDurationSec: number
  selectedAudioClipId: string | null
  selectedOverlayId: string | null
  selectedOverlayIds: string[]
  selectedCaptionBlockId: string | null
  selectedCaptionBlockIds: string[]
  selectedBlockId: string | null
}): SplitSelectionTarget | null {
  const {
    session,
    playheadSec,
    pxPerSec,
    transitionDurationSec,
    selectedAudioClipId,
    selectedOverlayId,
    selectedOverlayIds,
    selectedCaptionBlockId,
    selectedCaptionBlockIds,
    selectedBlockId,
  } = params

  if (selectedAudioClipId) {
    const clip = session.audio_elements?.find((item) => item.id === selectedAudioClipId)
    if (
      clip &&
      isPlayheadSplittableInRange(clip.start_sec, clip.duration_sec, playheadSec)
    ) {
      return { kind: 'audio_clip', clipId: clip.id }
    }
    return null
  }

  const overlayId =
    selectedOverlayIds.length > 0
      ? selectedOverlayIds[selectedOverlayIds.length - 1]!
      : selectedOverlayId
  if (overlayId) {
    const overlay = session.overlay_elements?.find((item) => item.id === overlayId)
    if (
      overlay &&
      isPlayheadSplittableInRange(overlay.start_sec, overlay.duration_sec, playheadSec)
    ) {
      return { kind: 'text_overlay', overlayId }
    }
    return null
  }

  const captionBlockId =
    selectedCaptionBlockIds.length > 0
      ? selectedCaptionBlockIds[selectedCaptionBlockIds.length - 1]!
      : selectedCaptionBlockId
  const blockId = captionBlockId ?? selectedBlockId
  if (!blockId) return null

  const segments = buildCompositionTimelineSegments(
    session.sequence,
    pxPerSec,
    transitionDurationSec
  )
  const segment = segments.find((item) => item.block.id === blockId)
  if (!segment) return null

  const relativeSec = playheadSec - segment.startSec
  if (
    relativeSec <= MIN_SPLIT_GAP_SEC ||
    relativeSec >= segment.duration - MIN_SPLIT_GAP_SEC
  ) {
    return null
  }

  return { kind: 'video_block', blockId }
}

export function resolveVideoBlockSplitAt(
  block: EditBlock,
  segmentStartSec: number,
  playheadSec: number,
  minGap = MIN_SPLIT_GAP_SEC
): number | null {
  const relativeSec = playheadSec - segmentStartSec
  const timelineDuration = blockDuration(block)
  if (relativeSec <= minGap || relativeSec >= timelineDuration - minGap) {
    return null
  }
  const splitAt = block.trim.in_sec + relativeSec * blockPlaybackRate(block)
  if (splitAt <= block.trim.in_sec + minGap || splitAt >= block.trim.out_sec - minGap) {
    return null
  }
  return splitAt
}

export function splitOverlayElement(
  overlay: EditOverlayElement,
  playheadSec: number,
  minGap = MIN_SPLIT_GAP_SEC
): { first: EditOverlayElement; second: Omit<EditOverlayElement, 'id'> } | null {
  if (!isPlayheadSplittableInRange(overlay.start_sec, overlay.duration_sec, playheadSec, minGap)) {
    return null
  }
  const offset = playheadSec - overlay.start_sec
  const cloned = JSON.parse(JSON.stringify(overlay)) as EditOverlayElement
  return {
    first: { ...overlay, duration_sec: offset },
    second: {
      ...cloned,
      start_sec: playheadSec,
      duration_sec: overlay.duration_sec - offset,
    },
  }
}

export function splitAudioClipElement(
  clip: AudioClipElement,
  playheadSec: number,
  minGap = MIN_SPLIT_GAP_SEC
): { first: AudioClipElement; second: Omit<AudioClipElement, 'id'> } | null {
  if (!isPlayheadSplittableInRange(clip.start_sec, clip.duration_sec, playheadSec, minGap)) {
    return null
  }
  const offset = playheadSec - clip.start_sec
  const trimStart = clip.trim_start_sec ?? 0
  const cloned = JSON.parse(JSON.stringify(clip)) as AudioClipElement
  return {
    first: {
      ...clip,
      duration_sec: offset,
      trim_end_sec: trimStart + offset,
    },
    second: {
      ...cloned,
      start_sec: playheadSec,
      duration_sec: clip.duration_sec - offset,
      trim_start_sec: trimStart + offset,
    },
  }
}
