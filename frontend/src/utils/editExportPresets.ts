import type { EditExportPreset } from '../types/editSession'

const STORAGE_KEY = 'autoclip.edit.exportPresets'

export const DEFAULT_EXPORT_PRESET: EditExportPreset = {
  aspect: '9:16',
  height: 1080,
  fps: 30,
  visual_filter: 'none',
  fit_mode: 'contain',
  burn_subtitles: true,
  export_srt: false,
  use_source_video: true,
}

export const loadExportPreset = (): EditExportPreset => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_EXPORT_PRESET
    return { ...DEFAULT_EXPORT_PRESET, ...(JSON.parse(raw) as Partial<EditExportPreset>) }
  } catch {
    return DEFAULT_EXPORT_PRESET
  }
}

export const saveExportPreset = (preset: EditExportPreset): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preset))
}

export const VISUAL_FILTER_OPTIONS = [
  { value: 'none', label: '无滤镜' },
  { value: 'mono_soft', label: '柔和单色' },
  { value: 'mono_contrast', label: '高对比' },
  { value: 'mono_cool', label: '冷色克制' },
  { value: 'mono_warm', label: '暖色克制' },
] as const

export const FIT_MODE_OPTIONS = [
  { value: 'contain', label: '适应（不放大）' },
  { value: 'contain_blur', label: '模糊背景' },
  { value: 'cover', label: '居中裁切' },
] as const
