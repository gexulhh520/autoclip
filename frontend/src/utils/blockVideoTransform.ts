import type { EditBlock, EditBlockVideoTransform, EditExportSettings } from '../types/editSession'
import { resolveOutputCanvas } from '../editor/compositor/geometry'

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

/** 叠画轨默认缩放（相对 contain 基准） */
export const DEFAULT_OVERLAY_VIDEO_SCALE = 0.32

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

/** 叠画轨默认画中画：右下角小窗，随画布尺寸自适应偏移 */
export function buildDefaultOverlayPictureInPictureTransform(
  exportSettings: EditExportSettings,
  sourceSize?: { width: number; height: number } | null
): Required<EditBlockVideoTransform> {
  const canvas = resolveOutputCanvas(exportSettings, sourceSize)
  const scale = DEFAULT_OVERLAY_VIDEO_SCALE
  return {
    scale_x: scale,
    scale_y: scale,
    position_x: Math.round(canvas.width * 0.28),
    position_y: Math.round(canvas.height * 0.28),
  }
}

export function blockVideoTransformIsUniform(transform: EditBlockVideoTransform | undefined): boolean {
  const scaleX = transform?.scale_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_x
  const scaleY = transform?.scale_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_y
  return Math.abs(scaleX - scaleY) < 0.025
}
