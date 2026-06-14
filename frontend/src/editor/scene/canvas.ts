import type { EditExportSettings } from '../../types/editSession'
import { resolveOutputCanvas } from '../compositor/geometry'

/** @deprecated 使用 compositor/geometry.resolveOutputCanvas */
export function resolveCanvasDimensions(
  settings: EditExportSettings,
  sourceSize?: { width: number; height: number } | null
): { width: number; height: number } {
  return resolveOutputCanvas(settings, sourceSize)
}
