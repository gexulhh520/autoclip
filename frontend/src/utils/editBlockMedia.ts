import type { EditBlock } from '../types/editSession'
import {
  audioAssetPreviewPlaybackUrl,
  blockPreviewPlaybackUrl,
  clipPreviewPlaybackUrl,
  sourcePreviewPlaybackUrl,
} from './previewMediaUrl'

export function isImportedBlock(block: EditBlock): boolean {
  return (
    block.media.type === 'imported_clip' ||
    block.source_clip_id.startsWith('import-') ||
    block.media.path.includes('edit_sessions/')
  )
}

/** 原片预览：播放 source_video_path 并按 source_start_sec 偏移 */
export function blockUsesSourceVideoPreview(
  block: EditBlock,
  useSourceVideo: boolean
): boolean {
  return Boolean(
    useSourceVideo &&
      block.media.source_video_path &&
      block.media.source_start_sec != null
  )
}

/** 与后端 _resolve_render_window 一致：播放当前 media 文件时需叠加 source_start_sec */
export function blockUsesMediaSourceOffset(
  block: EditBlock,
  useSourceVideo: boolean
): boolean {
  const offset = block.media.source_start_sec
  if (offset == null || offset <= 0) return false
  if (blockUsesSourceVideoPreview(block, useSourceVideo)) return true
  return isImportedBlock(block)
}

/** 合成相对时间 → 当前绑定视频元素应 seek 的 currentTime */
export function resolveBlockMediaTimeSec(
  block: EditBlock,
  relativeSec: number,
  useSourceVideo: boolean
): number {
  const inMediaSec = block.trim.in_sec + relativeSec
  if (blockUsesMediaSourceOffset(block, useSourceVideo)) {
    return block.media.source_start_sec! + inMediaSec
  }
  return inMediaSec
}

export function getBlockVideoUrl(
  projectId: string,
  sessionId: string,
  block: EditBlock
): string {
  if (isImportedBlock(block)) {
    return blockPreviewPlaybackUrl(projectId, sessionId, block.id)
  }
  return clipPreviewPlaybackUrl(projectId, block.source_clip_id, block.title)
}

export function getBlockVideoUrlForPreview(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): string {
  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const sourceId = block.media.source_video_path?.includes('sources/')
      ? block.media.source_video_path!
          .split('/')
          .find((_, index, parts) => parts[index - 1] === 'sources')
      : null
    return sourcePreviewPlaybackUrl(projectId, sourceId)
  }
  return blockPreviewPlaybackUrl(projectId, sessionId, block.id)
}

export function getAudioAssetPlaybackUrl(
  projectId: string,
  sessionId: string,
  assetId: string
): string {
  return audioAssetPreviewPlaybackUrl(projectId, sessionId, assetId)
}
