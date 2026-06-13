import type { EditExportSettings } from '../types/editSession'
import { formatCanvasAspectLabel } from './editAspectRatios'
import { FIT_MODE_OPTIONS, VISUAL_FILTER_OPTIONS } from './editExportPresets'

export function formatExportSettingsSummary(
  settings: EditExportSettings | undefined,
  videoNaturalSize?: { width: number; height: number } | null
): string {
  if (!settings) return ''
  const aspectLabel = formatCanvasAspectLabel(settings, videoNaturalSize)
  const fitLabel =
    FIT_MODE_OPTIONS.find((item) => item.value === (settings.fit_mode ?? 'contain'))?.label ??
    '适应（不放大）'
  const filterLabel =
    VISUAL_FILTER_OPTIONS.find((item) => item.value === (settings.visual_filter ?? 'none'))
      ?.label ?? '无滤镜'
  const resolution =
    settings.aspect === 'original' || settings.aspect === 'custom'
      ? aspectLabel
      : `${aspectLabel} · ${settings.height}p`
  return `${resolution} · ${fitLabel} · ${filterLabel}`
}
