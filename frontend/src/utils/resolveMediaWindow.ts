import type { EditBlock } from '../types/editSession'
import { blockPlaybackRate } from './editTimeline'

/** 预览/导出统一的「打开哪个文件 + 播放哪一段」语义 */
export interface BlockMediaWindow {
  /** session 内媒体相对路径（或 source 元数据路径），用于 decoder key */
  filePath: string
  /** 在该文件内的入点（秒） */
  mediaStartSec: number
  /** 在该文件内的出点（秒） */
  mediaEndSec: number
}

export function normalizeMediaFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

export function isImportedBlockMedia(block: EditBlock): boolean {
  return (
    block.media.type === 'imported_clip' ||
    block.source_clip_id.startsWith('import-') ||
    block.media.path.includes('edit_sessions/')
  )
}

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

/** EditBlock → 非破坏性媒体窗口（预览 seek / 导出窗口共用） */
export function resolveBlockMediaWindow(
  block: EditBlock,
  useSourceVideo: boolean
): BlockMediaWindow {
  const trimIn = Math.max(0, block.trim.in_sec)
  const trimOut = Math.max(trimIn + 0.001, block.trim.out_sec)

  if (blockUsesSourceVideoPreview(block, useSourceVideo)) {
    const base = block.media.source_start_sec ?? 0
    return {
      filePath: normalizeMediaFilePath(block.media.source_video_path!),
      mediaStartSec: base + trimIn,
      mediaEndSec: base + trimOut,
    }
  }

  const filePath = normalizeMediaFilePath(block.media.path)
  const base = isImportedBlockMedia(block) ? (block.media.source_start_sec ?? 0) : 0

  return {
    filePath,
    mediaStartSec: base + trimIn,
    mediaEndSec: base + trimOut,
  }
}

export function resolvePreviewMediaFileKey(
  block: EditBlock,
  useSourceVideo: boolean
): string {
  return resolveBlockMediaWindow(block, useSourceVideo).filePath
}

/** 合成相对时间 → 媒体文件内的 currentTime（非破坏性，仅读窗口） */
export function resolveBlockMediaTimeSec(
  block: EditBlock,
  relativeSec: number,
  useSourceVideo: boolean
): number {
  const window = resolveBlockMediaWindow(block, useSourceVideo)
  const rate = blockPlaybackRate(block)
  const elapsed = Math.max(0, relativeSec) * rate
  const end = window.mediaEndSec
  const start = window.mediaStartSec
  return Math.min(end, start + elapsed)
}

export function readVideoSourceRelativeSec(
  videoCurrentTime: number,
  block: EditBlock,
  useSourceVideo: boolean
): number {
  const start = resolveBlockMediaWindow(block, useSourceVideo).mediaStartSec
  return Math.max(0, videoCurrentTime - start)
}
