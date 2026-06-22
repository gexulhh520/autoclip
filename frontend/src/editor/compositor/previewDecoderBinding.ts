import type { EditBlock } from '../../types/editSession'
import { isImportedBlock, resolveBlockMediaTimeSec } from '../../utils/editBlockMedia'

/** 同源导入片段（含切割后多段）共用同一解码器，避免重复拉流 */
export function resolvePreviewDecoderKey(block: EditBlock): string {
  if (isImportedBlock(block) && block.media.path) {
    return `media:${block.media.path}`
  }
  return `block:${block.id}`
}

/** 仅在媒体源变化时更新 src，避免同文件多 block 反复触发加载 */
export function ensureDecoderBound(
  video: HTMLVideoElement,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string
): boolean {
  const decoderKey = resolvePreviewDecoderKey(block)
  const nextUrl = getVideoUrlForBlock(block)
  if (video.dataset.decoderKey === decoderKey && video.src) {
    video.dataset.boundBlockId = block.id
    return false
  }
  video.dataset.decoderKey = decoderKey
  video.dataset.boundBlockId = block.id
  video.src = nextUrl
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
