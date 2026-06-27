import type { EditBlock, EditBlockVideoTransform, EditExportSettings } from '../types/editSession'
import { resolveOutputCanvas } from '../editor/compositor/geometry'
import { isMainTrackBlock } from '../editor/videoTracks'

export const BLOCK_VIDEO_SCALE_MIN = 0.1
export const BLOCK_VIDEO_SCALE_MAX = 4
/** 画布中心像素偏移（正=向右/向下） */
export const BLOCK_VIDEO_POSITION_MIN = -2000
export const BLOCK_VIDEO_POSITION_MAX = 2000

export const DEFAULT_BLOCK_VIDEO_TRANSFORM: Required<EditBlockVideoTransform> = {
  scale_x: 1,
  scale_y: 1,
  position_x: 0,
  position_y: 0,
}

/** @deprecated 旧版叠画默认缩放，仅用于识别并迁移历史工程 */
export const LEGACY_DEFAULT_OVERLAY_VIDEO_SCALE = 0.32

/** @deprecated 请使用 LEGACY_DEFAULT_OVERLAY_VIDEO_SCALE */
export const DEFAULT_OVERLAY_VIDEO_SCALE = LEGACY_DEFAULT_OVERLAY_VIDEO_SCALE

export function clampBlockVideoScale(value: number): number {
  return Math.min(BLOCK_VIDEO_SCALE_MAX, Math.max(BLOCK_VIDEO_SCALE_MIN, value))
}

export function resolveBlockVideoTransform(
  block: EditBlock | null | undefined
): Required<EditBlockVideoTransform> {
  const raw = block?.video_transform
  return {
    scale_x: clampBlockVideoScale(raw?.scale_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_x),
    scale_y: clampBlockVideoScale(raw?.scale_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_y),
    position_x: raw?.position_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.position_x,
    position_y: raw?.position_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.position_y,
  }
}

export function isFullScreenBlockVideoTransform(
  transform: EditBlockVideoTransform | undefined
): boolean {
  const resolved = {
    scale_x: transform?.scale_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_x,
    scale_y: transform?.scale_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_y,
    position_x: transform?.position_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.position_x,
    position_y: transform?.position_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.position_y,
  }
  return (
    Math.abs(resolved.scale_x - 1) < 0.025 &&
    Math.abs(resolved.scale_y - 1) < 0.025 &&
    Math.abs(resolved.position_x) < 1 &&
    Math.abs(resolved.position_y) < 1
  )
}

/** 叠画轨默认与主轨一致：全画布 contain，除非用户自行调整缩放/位置 */
export function buildDefaultOverlayPictureInPictureTransform(
  _exportSettings?: EditExportSettings,
  _sourceSize?: { width: number; height: number } | null
): Required<EditBlockVideoTransform> {
  return { ...DEFAULT_BLOCK_VIDEO_TRANSFORM }
}

/** 旧版叠画默认（右下角小窗），用于迁移历史数据 */
export function buildLegacyDefaultOverlayPictureInPictureTransform(
  exportSettings: EditExportSettings,
  sourceSize?: { width: number; height: number } | null
): Required<EditBlockVideoTransform> {
  const canvas = resolveOutputCanvas(exportSettings, sourceSize)
  const scale = LEGACY_DEFAULT_OVERLAY_VIDEO_SCALE
  return {
    scale_x: scale,
    scale_y: scale,
    position_x: Math.round(canvas.width * 0.28),
    position_y: Math.round(canvas.height * 0.28),
  }
}

export function isLegacyDefaultOverlayPictureInPictureTransform(
  transform: EditBlockVideoTransform | undefined,
  exportSettings: EditExportSettings,
  sourceSize?: { width: number; height: number } | null
): boolean {
  if (!transform) return false
  const legacy = buildLegacyDefaultOverlayPictureInPictureTransform(exportSettings, sourceSize)
  return (
    Math.abs((transform.scale_x ?? 1) - legacy.scale_x) < 0.025 &&
    Math.abs((transform.scale_y ?? 1) - legacy.scale_y) < 0.025 &&
    Math.abs((transform.position_x ?? 0) - legacy.position_x) < 2 &&
    Math.abs((transform.position_y ?? 0) - legacy.position_y) < 2
  )
}

export function normalizeLegacyOverlayPictureInPictureTransforms(
  session: { sequence: EditBlock[]; export_settings: EditExportSettings }
): boolean {
  let changed = false
  for (const block of session.sequence) {
    if (isMainTrackBlock(block)) continue
    if (!isLegacyDefaultOverlayPictureInPictureTransform(block.video_transform, session.export_settings)) {
      continue
    }
    block.video_transform = { ...DEFAULT_BLOCK_VIDEO_TRANSFORM }
    changed = true
  }
  return changed
}

export function blockVideoTransformIsUniform(transform: EditBlockVideoTransform | undefined): boolean {
  const scaleX = transform?.scale_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_x
  const scaleY = transform?.scale_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_y
  return Math.abs(scaleX - scaleY) < 0.025
}
