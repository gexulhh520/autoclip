import type { TextElementParams } from '../opencut-text/params'
import type { CompositorEffectDefinition } from './types'

const PRESET_PARAM_PATCHES: Record<string, Partial<TextElementParams>> = {
  'text.preset.cinema_glow': {
    'shadow.enabled': true,
    'shadow.color': 'rgba(0,0,0,0.55)',
    'shadow.offsetX': 0,
    'shadow.offsetY': 1,
    'shadow.blur': 2,
    'shadow.glowBlur': 12,
    'shadow.glowColor': 'rgba(0,0,0,0.35)',
    'outline.enabled': false,
    'background.enabled': false,
    'style.preset': 'cinema_glow',
  },
  'text.preset.highlight_box': {
    'background.enabled': true,
    'background.color': 'rgba(0,0,0,0.55)',
    'background.cornerRadius': 12,
    'background.paddingX': 24,
    'background.paddingY': 16,
    'shadow.enabled': false,
    'outline.enabled': false,
    'style.preset': 'highlight_box',
  },
}

/** 花字 preset 槽位 — Phase 3 扩展点（text + effect stack） */
export const TEXT_PRESET_EFFECTS: CompositorEffectDefinition[] = [
  {
    id: 'text.preset.cinema_glow',
    category: 'text',
    label: '影院光晕',
  },
  {
    id: 'text.preset.highlight_box',
    category: 'text',
    label: '高亮底框',
  },
]

export function applyTextPresetToParams(
  params: TextElementParams,
  presetId: string
): TextElementParams {
  const patch = PRESET_PARAM_PATCHES[presetId]
  if (!patch) return params
  return { ...params, ...patch }
}

export function readTextPresetId(params: TextElementParams): string | null {
  const value = params['style.preset']
  if (typeof value !== 'string' || !value) return null
  return `text.preset.${value}`
}
