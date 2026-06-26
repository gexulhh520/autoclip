import type { EditBlock } from '../types/editSession'
import {
  audioAssetPreviewPlaybackUrl,
  blockPreviewPlaybackUrl,
  clipPreviewPlaybackUrl,
  projectMediaPreviewPlaybackUrl,
  sourcePreviewPlaybackUrl,
} from './previewMediaUrl'
import {
  blockUsesSourceVideoPreview,
  isImportedBlockMedia,
  normalizeMediaFilePath,
  readVideoSourceRelativeSec,
  resolveBlockMediaTimeSec,
  resolveBlockMediaWindow,
  resolvePreviewMediaFileKey,
} from './resolveMediaWindow'

export {
  blockUsesSourceVideoPreview,
  isImportedBlockMedia as isImportedBlock,
  readVideoSourceRelativeSec,
  resolveBlockMediaTimeSec,
  resolveBlockMediaWindow,
  resolvePreviewMediaFileKey,
}

/** @deprecated 使用 resolveBlockMediaWindow；保留兼容旧调用 */
export function blockUsesMediaSourceOffset(
  block: EditBlock,
  useSourceVideo: boolean
): boolean {
  const window = resolveBlockMediaWindow(block, useSourceVideo)
  return window.mediaStartSec > 0 || isImportedBlockMedia(block)
}

export function getBlockVideoUrl(
  projectId: string,
  sessionId: string,
  block: EditBlock
): string {
  if (isImportedBlockMedia(block)) {
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

  const filePath = normalizeMediaFilePath(block.media.path)
  return projectMediaPreviewPlaybackUrl(projectId, filePath, {
    httpFallback: blockPreviewPlaybackUrl(projectId, sessionId, block.id),
  })
}

export function getAudioAssetPlaybackUrl(
  projectId: string,
  sessionId: string,
  assetId: string
): string {
  return audioAssetPreviewPlaybackUrl(projectId, sessionId, assetId)
}
