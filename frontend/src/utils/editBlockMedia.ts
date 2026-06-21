import editApi from '../services/editApi'
import { projectApi } from '../services/api'
import type { EditBlock } from '../types/editSession'

export function isImportedBlock(block: EditBlock): boolean {
  return (
    block.media.type === 'imported_clip' ||
    block.source_clip_id.startsWith('import-') ||
    block.media.path.includes('edit_sessions/')
  )
}

/** 与后端 _resolve_render_window 一致：仅在使用原片预览时才偏移 source_start_sec */
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

/** 合成相对时间 → 当前绑定视频元素应 seek 的 currentTime */
export function resolveBlockMediaTimeSec(
  block: EditBlock,
  relativeSec: number,
  useSourceVideo: boolean
): number {
  const inMediaSec = block.trim.in_sec + relativeSec
  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
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
    return editApi.getBlockMediaUrl(projectId, sessionId, block.id)
  }
  return projectApi.getClipVideoUrl(projectId, block.source_clip_id, block.title)
}

export function getBlockVideoUrlForPreview(
  projectId: string,
  sessionId: string,
  block: EditBlock,
  useSourceVideo: boolean
): string {
  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const sourceId = block.media.source_video_path!.includes('sources/')
      ? block.media.source_video_path!
          .split('/')
          .find((_, index, parts) => parts[index - 1] === 'sources')
      : null
    return projectApi.getSourceVideoUrl(projectId, sourceId)
  }
  return getBlockVideoUrl(projectId, sessionId, block)
}
