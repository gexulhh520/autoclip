import type { EditExportSettings } from '../types/editSession'

export type EditAspectPresetId =
  | 'original'
  | 'custom'
  | '16:9'
  | '4:3'
  | '2.35:1'
  | '2:1'
  | '1.85:1'
  | '9:16'
  | '3:4'
  | '5.8'
  | '1:1'
  | '1:2'

export interface EditAspectPreset {
  id: EditAspectPresetId
  label: string
  hint?: string
  ratioW?: number
  ratioH?: number
}

export const EDIT_ASPECT_PRESETS: EditAspectPreset[] = [
  { id: 'original', label: '适应（原始）' },
  { id: 'custom', label: '自定义' },
  { id: '16:9', label: '16:9', hint: '西瓜视频', ratioW: 16, ratioH: 9 },
  { id: '4:3', label: '4:3', ratioW: 4, ratioH: 3 },
  { id: '2.35:1', label: '2.35:1', ratioW: 47, ratioH: 20 },
  { id: '2:1', label: '2:1', ratioW: 2, ratioH: 1 },
  { id: '1.85:1', label: '1.85:1', ratioW: 37, ratioH: 20 },
  { id: '9:16', label: '9:16', hint: '抖音', ratioW: 9, ratioH: 16 },
  { id: '3:4', label: '3:4', ratioW: 3, ratioH: 4 },
  { id: '5.8', label: '5.8 寸', ratioW: 9, ratioH: 19.5 },
  { id: '1:1', label: '1:1', ratioW: 1, ratioH: 1 },
  { id: '1:2', label: '1:2', ratioW: 1, ratioH: 2 },
]

const PRESET_BY_ID = Object.fromEntries(
  EDIT_ASPECT_PRESETS.map((preset) => [preset.id, preset])
) as Record<EditAspectPresetId, EditAspectPreset>

export const LEGACY_ASPECT_IDS: EditAspectPresetId[] = ['9:16', '16:9', '1:1']

export function normalizeAspectPresetId(value: string | undefined | null): EditAspectPresetId {
  if (value && value in PRESET_BY_ID) {
    return value as EditAspectPresetId
  }
  return '9:16'
}

export function getAspectPreset(id: EditAspectPresetId): EditAspectPreset {
  return PRESET_BY_ID[id]
}

export function getAspectPresetLabel(id: EditAspectPresetId): string {
  const preset = getAspectPreset(id)
  if (preset.id === 'original') return '原始'
  if (preset.id === 'custom') return '自定义'
  return preset.label
}

export interface CanvasAspectRatio {
  width: number
  height: number
  isOriginal: boolean
}

export function resolveCanvasAspectRatio(
  settings: EditExportSettings | undefined | null,
  videoNaturalSize?: { width: number; height: number } | null
): CanvasAspectRatio {
  const aspect = normalizeAspectPresetId(settings?.aspect)

  if (aspect === 'original') {
    if (videoNaturalSize && videoNaturalSize.width > 0 && videoNaturalSize.height > 0) {
      return { ...videoNaturalSize, isOriginal: true }
    }
    return { width: 16, height: 9, isOriginal: true }
  }

  if (aspect === 'custom') {
    const width = Math.max(1, settings?.custom_width ?? 1080)
    const height = Math.max(1, settings?.custom_height ?? 1920)
    return { width, height, isOriginal: false }
  }

  const preset = getAspectPreset(aspect)
  return {
    width: preset.ratioW ?? 9,
    height: preset.ratioH ?? 16,
    isOriginal: false,
  }
}

export function formatCanvasAspectLabel(
  settings: EditExportSettings | undefined | null,
  videoNaturalSize?: { width: number; height: number } | null
): string {
  const aspect = normalizeAspectPresetId(settings?.aspect)
  if (aspect === 'original') {
    if (videoNaturalSize) {
      return `${videoNaturalSize.width}×${videoNaturalSize.height}`
    }
    return '原始'
  }
  if (aspect === 'custom') {
    const width = settings?.custom_width ?? 1080
    const height = settings?.custom_height ?? 1920
    return `${width}×${height}`
  }
  return getAspectPreset(aspect).label
}

export function resolveExportDimensions(
  settings: EditExportSettings,
  sourceWidth?: number,
  sourceHeight?: number
): { width: number; height: number } {
  const aspect = normalizeAspectPresetId(settings.aspect)

  if (aspect === 'original') {
    if (sourceWidth && sourceHeight) {
      return { width: sourceWidth, height: sourceHeight }
    }
    return { width: 1920, height: 1080 }
  }

  if (aspect === 'custom') {
    return {
      width: Math.max(2, settings.custom_width ?? 1080),
      height: Math.max(2, settings.custom_height ?? 1920),
    }
  }

  const preset = getAspectPreset(aspect)
  const ratioW = preset.ratioW ?? 9
  const ratioH = preset.ratioH ?? 16
  const outHeight = Math.max(2, settings.height)
  let outWidth = Math.max(2, Math.round(outHeight * (ratioW / ratioH)))
  if (outWidth % 2) outWidth += 1
  let evenHeight = outHeight
  if (evenHeight % 2) evenHeight += 1
  return { width: outWidth, height: evenHeight }
}
