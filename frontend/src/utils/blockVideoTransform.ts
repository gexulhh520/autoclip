import type { EditBlock, EditBlockVideoTransform } from '../types/editSession'

export const BLOCK_VIDEO_SCALE_MIN = 0.1
export const BLOCK_VIDEO_SCALE_MAX = 4

export const DEFAULT_BLOCK_VIDEO_TRANSFORM: Required<EditBlockVideoTransform> = {
  scale_x: 1,
  scale_y: 1,
  position_x: 0,
  position_y: 0,
}

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

export function blockVideoTransformIsUniform(transform: EditBlockVideoTransform | undefined): boolean {
  const scaleX = transform?.scale_x ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_x
  const scaleY = transform?.scale_y ?? DEFAULT_BLOCK_VIDEO_TRANSFORM.scale_y
  return Math.abs(scaleX - scaleY) < 0.025
}
