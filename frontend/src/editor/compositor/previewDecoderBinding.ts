import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import { isImportedBlock, resolveBlockMediaTimeSec } from '../../utils/editBlockMedia'
import {
  ensurePreviewMediaPrefetch,
  resolveEffectivePreviewUrl,
} from '../../utils/previewLocalMedia'
import type { PreviewLocalMediaContext } from '../../utils/previewLocalMedia'
import { resolveMainTrackBlocks } from '../videoTracks'

export type { PreviewLocalMediaContext } from '../../utils/previewLocalMedia'

/**
 * 叠化转场期间 outgoing/incoming 需同时显示不同帧，不能与邻段共用解码器。
 * 有 cross 转场的 outgoing 在整段播放期间还会预热 incoming，共用解码器会被 warmup seek 抢掉。
 */
export function blockNeedsDedicatedPreviewDecoder(
  block: EditBlock,
  session?: EditSession | null
): boolean {
  if (!session) return false

  const blocks = resolveMainTrackBlocks(session)
  const index = blocks.findIndex((item) => item.id === block.id)
  if (index < 0) return false

  if (index < blocks.length - 1 && isCrossTransition(blocks[index]!.transition_out)) {
    return true
  }
  if (index > 0 && isCrossTransition(blocks[index - 1]!.transition_out)) {
    return true
  }
  return false
}

/** 同源导入片段（含切割后多段）共用同一解码器，避免重复拉流 */
export function resolvePreviewDecoderKey(
  block: EditBlock,
  session?: EditSession | null
): string {
  if (
    isImportedBlock(block) &&
    block.media.path &&
    !blockNeedsDedicatedPreviewDecoder(block, session)
  ) {
    return `media:${block.media.path}`
  }
  return `block:${block.id}`
}

/** 仅在媒体源变化时更新 src，避免同文件多 block 反复触发加载 */
export function ensureDecoderBound(
  video: HTMLVideoElement,
  block: EditBlock,
  getVideoUrlForBlock: (block: EditBlock) => string,
  session?: EditSession | null,
  localMedia?: PreviewLocalMediaContext | null
): boolean {
  if (localMedia) {
    ensurePreviewMediaPrefetch(
      localMedia.projectId,
      localMedia.sessionId,
      block,
      localMedia.useSourceVideo
    )
  }
  const decoderKey = resolvePreviewDecoderKey(block, session)
  const httpUrl = getVideoUrlForBlock(block)
  const nextUrl = resolveEffectivePreviewUrl(httpUrl)
  const boundUrl = video.dataset.effectiveUrl ?? video.src
  if (video.dataset.decoderKey === decoderKey && boundUrl) {
    video.dataset.boundBlockId = block.id
    if (nextUrl === boundUrl) return false
    // 同源多 block 共用解码器：仅 HTTP→asset 升级，不因 block 级 URL 差异重载
    if (nextUrl !== httpUrl) {
      video.dataset.effectiveUrl = nextUrl
      video.src = nextUrl
      return true
    }
    return false
  }
  video.dataset.decoderKey = decoderKey
  video.dataset.boundBlockId = block.id
  video.dataset.effectiveUrl = nextUrl
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
