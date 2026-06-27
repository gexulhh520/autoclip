import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import { resolveBlockMediaTimeSec, resolvePreviewMediaFileKey } from '../../utils/resolveMediaWindow'
import { applyPreviewVideoSrc } from '../../utils/previewMediaUrl'
import { isMainTrackBlock } from '../videoTracks'
import { isVoiceoverBrollBlock } from '../voiceover/voiceoverBroll'

/**
 * 叠化转场期间 outgoing/incoming 需同时显示不同帧，不能与邻段共用解码器。
 * 有 cross 转场的 outgoing 在整段播放期间还会预热 incoming，共用解码器会被 warmup seek 抢掉。
 */
export function blockNeedsDedicatedPreviewDecoder(
  block: EditBlock,
  session?: EditSession | null
): boolean {
  if (!session || !isMainTrackBlock(block)) return false

  const index = session.sequence.findIndex((item) => item.id === block.id)
  if (index < 0) return false

  if (
    index < session.sequence.length - 1 &&
    isCrossTransition(block.transition_out)
  ) {
    return true
  }
  const prev = session.sequence[index - 1]
  if (prev && isMainTrackBlock(prev) && isCrossTransition(prev.transition_out)) {
    return true
  }
  return false
}

/** 主轨同源媒体可共用解码器；叠画/B-roll/转场邻段独立 */
export function shouldSharePreviewDecoder(
  block: EditBlock,
  session?: EditSession | null
): boolean {
  if (!isMainTrackBlock(block)) return false
  if (isVoiceoverBrollBlock(block, session)) return false
  if (blockNeedsDedicatedPreviewDecoder(block, session)) return false
  return true
}

/** 同源媒体（含切割多段）共用 decoder；URL 按 media.path 稳定 */
export function resolvePreviewDecoderKey(
  block: EditBlock,
  session?: EditSession | null,
  useSourceVideo = false
): string {
  const fileKey = resolvePreviewMediaFileKey(block, useSourceVideo)
  if (fileKey && shouldSharePreviewDecoder(block, session)) {
    return `media:${fileKey}`
  }
  return `block:${block.id}`
}

/** 仅在媒体源变化时更新 src，避免同文件多 block 反复触发加载 */
export function ensureDecoderBound(
  video: HTMLVideoElement,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string,
  session?: EditSession | null,
  useSourceVideo = false
): boolean {
  const decoderKey = resolvePreviewDecoderKey(block, session, useSourceVideo)
  const nextUrl = getVideoUrlForBlock(block)
  const boundUrl = video.dataset.effectiveUrl ?? video.src

  if (video.dataset.decoderKey === decoderKey) {
    video.dataset.boundBlockId = block.id
    if (boundUrl === nextUrl) {
      return false
    }
    applyPreviewVideoSrc(video, nextUrl)
    return true
  }

  video.dataset.decoderKey = decoderKey
  video.dataset.boundBlockId = block.id
  applyPreviewVideoSrc(video, nextUrl)
  return true
}

/** 深 seek 需要更多缓冲，否则 readyState 长期 < 2 导致灰屏 */
export function ensureDecoderPreloadForTargetTime(
  video: HTMLVideoElement,
  targetSec: number
): void {
  if (targetSec > 0.5 && video.preload !== 'auto') {
    video.preload = 'auto'
  }
}

export function ensureDecoderPreloadForTarget(
  video: HTMLVideoElement,
  block: EditBlock,
  relativeSec: number,
  useSourceVideo: boolean
): void {
  ensureDecoderPreloadForTargetTime(
    video,
    resolveBlockMediaTimeSec(block, relativeSec, useSourceVideo)
  )
}

export function clearDecoderBinding(video: HTMLVideoElement | null): void {
  if (!video) return
  delete video.dataset.boundBlockId
  delete video.dataset.decoderKey
}
