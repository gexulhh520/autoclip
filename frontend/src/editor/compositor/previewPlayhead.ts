import type { EditBlock } from '../../types/editSession'
import type { CompositionTimeline } from '../scene/types'
import {
  mapRelativeSourceToCompositionTime,
} from '../scene/timelineLayout'

/** 缓入缓出，让转场首尾更自然 */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function readVideoSourceRelativeSec(
  video: HTMLVideoElement,
  block: EditBlock,
  useSourceVideo: boolean
): number {
  if (useSourceVideo && block.media.source_start_sec != null) {
    return video.currentTime - block.media.source_start_sec - block.trim.in_sec
  }
  return video.currentTime - block.trim.in_sec
}

export function compositionTimeFromVideo(
  video: HTMLVideoElement,
  block: EditBlock,
  segmentStartSec: number,
  useSourceVideo: boolean,
  options?: {
    timeline?: CompositionTimeline
    segmentIndex?: number
  }
): number {
  const relative = Math.max(0, readVideoSourceRelativeSec(video, block, useSourceVideo))

  if (options?.timeline != null && options.segmentIndex != null) {
    const segment = options.timeline.segments[options.segmentIndex]
    if (segment) {
      return mapRelativeSourceToCompositionTime(segment, relative, options.timeline)
    }
  }

  const rate = Math.max(0.25, Math.min(4, block.playback_rate ?? 1))
  return segmentStartSec + relative / rate
}

export const PREVIEW_PRIMARY_VIDEO_SELECTOR = '[data-composition-clock="true"]'

export interface ResolvePreviewLivePlayheadOptions {
  isPlaying: boolean
  storePlayheadSec: number
  totalDurationSec: number
  primaryBlock: EditBlock | null
  segmentStartSec: number
  useSourceVideo: boolean
  timeline?: CompositionTimeline
  segmentIndex?: number
  videoSelector?: string
}

/** 与 CompositorPreview 一致：播放中从 video.currentTime 推算平滑 composition 时间 */
export function resolvePreviewLivePlayheadSec(
  options: ResolvePreviewLivePlayheadOptions
): number {
  const {
    isPlaying,
    storePlayheadSec,
    totalDurationSec,
    primaryBlock,
    segmentStartSec,
    useSourceVideo,
    timeline,
    segmentIndex,
    videoSelector = PREVIEW_PRIMARY_VIDEO_SELECTOR,
  } = options

  if (!isPlaying || !primaryBlock) {
    return Math.max(0, Math.min(totalDurationSec, storePlayheadSec))
  }

  const video = document.querySelector<HTMLVideoElement>(videoSelector)
  if (!video || video.readyState < 2) {
    return Math.max(0, Math.min(totalDurationSec, storePlayheadSec))
  }

  const live = compositionTimeFromVideo(
    video,
    primaryBlock,
    segmentStartSec,
    useSourceVideo,
    timeline != null && segmentIndex != null ? { timeline, segmentIndex } : undefined
  )
  return Math.max(0, Math.min(totalDurationSec, live))
}
