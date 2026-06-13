import type { CSSProperties } from 'react'
import type { EditExportSettings } from '../types/editSession'

export const VISUAL_FILTER_CSS: Record<
  EditExportSettings['visual_filter'],
  string | undefined
> = {
  none: undefined,
  mono_soft: 'brightness(1.02) saturate(0.65) contrast(1.05)',
  mono_contrast: 'contrast(1.18) brightness(0.97) saturate(0.55)',
  mono_cool: 'saturate(0.5) brightness(1.01)',
  mono_warm: 'saturate(0.62) brightness(1.03) contrast(1.06)',
}

export function resolveVisualFilterStyle(
  filter: EditExportSettings['visual_filter'] | undefined
): CSSProperties | undefined {
  const css = VISUAL_FILTER_CSS[filter ?? 'none']
  if (!css) return undefined
  return { filter: css }
}
