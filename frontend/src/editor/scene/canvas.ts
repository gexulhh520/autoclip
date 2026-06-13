import type { EditExportSettings } from '../../types/editSession'

const ASPECT_RATIOS: Record<string, [number, number]> = {
  '16:9': [16, 9],
  '4:3': [4, 3],
  '2.35:1': [47, 20],
  '2:1': [2, 1],
  '1.85:1': [37, 20],
  '9:16': [9, 16],
  '3:4': [3, 4],
  '5.8': [9, 195],
  '1:1': [1, 1],
  '1:2': [1, 2],
}

const ensureEven = (value: number): number => {
  const size = Math.max(2, Math.round(value))
  return size % 2 === 0 ? size : size + 1
}

/** 与 backend edit_renderer.target_dimensions 对齐 */
export function resolveCanvasDimensions(
  settings: EditExportSettings,
  sourceSize?: { width: number; height: number } | null
): { width: number; height: number } {
  const height = settings.height || 1080

  if (settings.aspect === 'original') {
    if (sourceSize?.width && sourceSize?.height) {
      return {
        width: ensureEven(sourceSize.width),
        height: ensureEven(sourceSize.height),
      }
    }
    return { width: 1920, height: 1080 }
  }

  if (settings.aspect === 'custom') {
    return {
      width: ensureEven(settings.custom_width ?? 1080),
      height: ensureEven(settings.custom_height ?? 1920),
    }
  }

  const [rw, rh] = ASPECT_RATIOS[settings.aspect] ?? [9, 16]
  const outH = ensureEven(height)
  const outW = ensureEven((outH * rw) / rh)
  return { width: outW, height: outH }
}
