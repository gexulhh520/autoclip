import type { CSSProperties } from 'react'
import type { EditExportSettings } from '../types/editSession'
import { VISUAL_FILTER_CSS, resolveVisualFilterCss } from '../editor/effects'

export { VISUAL_FILTER_CSS }

export function resolveVisualFilterStyle(
  filter: EditExportSettings['visual_filter'] | undefined
): CSSProperties | undefined {
  const css = resolveVisualFilterCss(filter)
  if (!css) return undefined
  return { filter: css }
}
