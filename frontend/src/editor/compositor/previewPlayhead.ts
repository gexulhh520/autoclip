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
