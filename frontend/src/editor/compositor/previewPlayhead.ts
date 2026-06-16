import type { EditBlock } from '../../types/editSession'

/** 缓入缓出，让转场首尾更自然 */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export function compositionTimeFromVideo(
  video: HTMLVideoElement,
  block: EditBlock,
  segmentStartSec: number,
  useSourceVideo: boolean
): number {
  let relative = 0
  if (useSourceVideo && block.media.source_start_sec != null) {
    relative =
      video.currentTime - block.media.source_start_sec - block.trim.in_sec
  } else {
    relative = video.currentTime - block.trim.in_sec
  }
  const rate = Math.max(0.25, Math.min(4, block.playback_rate ?? 1))
  return segmentStartSec + Math.max(0, relative) / rate
}

export const PREVIEW_PRIMARY_VIDEO_SELECTOR = '.compositor-preview__decoder'

export interface ResolvePreviewLivePlayheadOptions {
  isPlaying: boolean
  storePlayheadSec: number
  totalDurationSec: number
  primaryBlock: EditBlock | null
  segmentStartSec: number
  useSourceVideo: boolean
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
    useSourceVideo
  )
  return Math.max(0, Math.min(totalDurationSec, live))
}
