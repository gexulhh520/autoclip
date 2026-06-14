import type { VisualFilterId } from './types'
import { listEffects } from './registry'
import { resolveVisualFilterCss } from './filters'
import { TEXT_PRESET_EFFECTS } from './textPresets'

export interface VisualFilterUiOption {
  value: VisualFilterId
  label: string
  effectId: string
  previewCss?: string
}

const FILTER_VALUE_BY_EFFECT_ID: Record<string, VisualFilterId> = {
  'filter.none': 'none',
  'filter.mono_soft': 'mono_soft',
  'filter.mono_contrast': 'mono_contrast',
  'filter.mono_cool': 'mono_cool',
  'filter.mono_warm': 'mono_warm',
}

/** Effect Registry → Inspector / 素材面板滤镜选项 */
export function listVisualFilterUiOptions(): VisualFilterUiOption[] {
  return listEffects('filter').map((def) => {
    const value = FILTER_VALUE_BY_EFFECT_ID[def.id] ?? 'none'
    const css = resolveVisualFilterCss(value)
    return {
      value,
      label: def.label,
      effectId: def.frameEffectId ?? def.id,
      previewCss: css,
    }
  })
}

export interface TransitionUiOption {
  value: 'cut' | 'dissolve'
  label: string
  effectId: string
}

/** 转场效果 UI 元数据（片段 Inspector 可复用） */
export function listTransitionUiOptions(): TransitionUiOption[] {
  return listEffects('transition').map((def) => ({
    value: def.id === 'transition.dissolve' ? 'dissolve' : 'cut',
    label: def.label,
    effectId: def.id,
  }))
}

export interface TextPresetUiOption {
  effectId: string
  label: string
}

export function listTextPresetUiOptions(): TextPresetUiOption[] {
  return TEXT_PRESET_EFFECTS.map((def) => ({
    effectId: def.id,
    label: def.label,
  }))
}
