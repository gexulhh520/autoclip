import type { EditBlock, EditSession } from '../../types/editSession'
import { isCrossTransition } from '../../types/transitions'
import { isImportedBlock, resolveBlockMediaTimeSec } from '../../utils/editBlockMedia'
import {
  applyPreviewVideoSrc,
  buildPreviewMediaRequest,
  ensurePreviewMediaPrefetch,
  isLocalPreviewMediaUrl,
  resolveEffectivePreviewUrl,
} from '../../utils/previewLocalMedia'
import type { PreviewLocalMediaContext } from '../../utils/previewLocalMedia'
import { isMainTrackBlock, resolveMainTrackBlocks } from '../videoTracks'
import { isVoiceoverBrollBlock } from '../voiceover/voiceoverBroll'

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

/** 同源导入仅主轨切割段可共用解码器；叠画轨（含口播 B-roll）各段独立，避免 seek 互相抢帧 */
export function shouldShareImportedPreviewDecoder(
  block: EditBlock,
  session?: EditSession | null
): boolean {
  if (!isMainTrackBlock(block)) return false
  if (isVoiceoverBrollBlock(block, session)) return false
  if (blockNeedsDedicatedPreviewDecoder(block, session)) return false
  return true
}

/** 同源导入片段（含切割后多段）共用同一解码器，避免重复拉流 */
export function resolvePreviewDecoderKey(
  block: EditBlock,
  session?: EditSession | null
): string {
  if (
    isImportedBlock(block) &&
    block.media.path &&
    shouldShareImportedPreviewDecoder(block, session)
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
  const mediaReq = localMedia
    ? buildPreviewMediaRequest(
        localMedia.projectId,
        localMedia.sessionId,
        block,
        localMedia.useSourceVideo
      )
    : null
  const cacheKey = mediaReq?.cacheKey ?? httpUrl
  // 预览解码器统一 HTTP（含主轨导入），避免暂停 asset / 播放 HTTP 换源导致重复帧
  const nextUrl = resolveEffectivePreviewUrl(httpUrl, cacheKey, { preferLocal: false })
  const boundUrl = video.dataset.effectiveUrl ?? video.src
  if (video.dataset.decoderKey === decoderKey && boundUrl) {
    video.dataset.boundBlockId = block.id
    if (nextUrl === boundUrl) return false
    const boundIsLocal = isLocalPreviewMediaUrl(boundUrl)
    const nextIsLocal = isLocalPreviewMediaUrl(nextUrl)
    if (!boundIsLocal && !nextIsLocal) return false
    applyPreviewVideoSrc(video, nextUrl, httpUrl, cacheKey)
    return true
  }
  video.dataset.decoderKey = decoderKey
  video.dataset.boundBlockId = block.id
  applyPreviewVideoSrc(video, nextUrl, httpUrl, cacheKey)
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
